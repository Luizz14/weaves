import type { StartupMarker } from "shared/startup-diagnostics";

export function createStartupRecorder({
	now,
	write,
}: {
	now: () => number;
	write: (record: { marker: StartupMarker; durationMs: number }) => void;
}) {
	const recorded = new Set<StartupMarker>();
	return (marker: StartupMarker, durationMs?: number) => {
		if (recorded.has(marker)) return;
		const value =
			marker === "process-start"
				? 0
				: durationMs === undefined
					? now()
					: durationMs;
		if (!Number.isFinite(value) || value < 0) return;
		recorded.add(marker);
		write({ marker, durationMs: value });
	};
}
