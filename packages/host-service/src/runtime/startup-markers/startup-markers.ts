import {
	formatStartupMarkerLine,
	type HostStartupMarker,
	STARTUP_DIAGNOSTICS_CHILD_ENV,
} from "@superset/shared/startup-markers";

const enabled = process.env[STARTUP_DIAGNOSTICS_CHILD_ENV] === "1";
const recorded = new Set<HostStartupMarker>();

export function markHostStartup(
	marker: HostStartupMarker,
	hrtimeNs: bigint = process.hrtime.bigint(),
): void {
	if (!enabled || recorded.has(marker)) return;
	recorded.add(marker);
	process.stdout.write(formatStartupMarkerLine(marker, hrtimeNs));
}

export function processStartHrtime(): bigint {
	return process.hrtime.bigint() - BigInt(Math.round(process.uptime() * 1e9));
}
