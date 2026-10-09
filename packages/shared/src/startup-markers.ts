export const HOST_STARTUP_MARKERS = [
	"host-process-start",
	"host-imports-end",
	"host-db-ready",
	"host-app-created",
	"host-listening",
	"host-terminal-env-ready",
	"host-daemon-ready",
	"host-first-attach-start",
	"host-first-attach-ready",
] as const;

export type HostStartupMarker = (typeof HOST_STARTUP_MARKERS)[number];

export const STARTUP_MARKER_LINE_PREFIX = "@@superset-startup ";
export const STARTUP_DIAGNOSTICS_CHILD_ENV =
	"SUPERSET_STARTUP_DIAGNOSTICS_CHILD";
export const HOST_READY_LINE = "@@superset-host-ready";
export const HOST_LOGIN_SHELL_MERGE_ENV = "SUPERSET_HOST_LOGIN_SHELL_MERGE";

const MAX_CARRY_LENGTH = 4096;

export function isHostStartupMarker(value: string): value is HostStartupMarker {
	return (HOST_STARTUP_MARKERS as readonly string[]).includes(value);
}

export function formatStartupMarkerLine(
	marker: HostStartupMarker,
	hrtimeNs: bigint,
): string {
	return `${STARTUP_MARKER_LINE_PREFIX}${marker} ${hrtimeNs}\n`;
}

export interface ParsedStartupMarker {
	marker: HostStartupMarker;
	hrtimeNs: bigint;
}

export function parseStartupMarkerLines(
	carry: string,
	chunk: string,
): { carry: string; markers: ParsedStartupMarker[] } {
	const lines = (carry + chunk).split("\n");
	const rest = lines.pop() ?? "";
	const markers: ParsedStartupMarker[] = [];
	for (const line of lines) {
		const start = line.indexOf(STARTUP_MARKER_LINE_PREFIX);
		if (start === -1) continue;
		const [name, value] = line
			.slice(start + STARTUP_MARKER_LINE_PREFIX.length)
			.trim()
			.split(" ");
		if (!name || !value || !isHostStartupMarker(name) || !/^\d+$/.test(value)) {
			continue;
		}
		markers.push({ marker: name, hrtimeNs: BigInt(value) });
	}
	return {
		carry:
			rest.length > MAX_CARRY_LENGTH ? rest.slice(-MAX_CARRY_LENGTH) : rest,
		markers,
	};
}
