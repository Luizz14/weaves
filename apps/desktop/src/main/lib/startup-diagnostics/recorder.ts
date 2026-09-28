import type { StartupMarker } from "shared/startup-diagnostics";

export function createStartupRecorder({
	now,
	write,
}: {
	now: () => number;
	write: (record: { marker: StartupMarker; durationMs: number }) => void;
}) {
	const recorded = new Set<StartupMarker>();
	return (marker: StartupMarker) => {
		if (recorded.has(marker)) return;
		recorded.add(marker);
		write({
			marker,
			durationMs: marker === "process-start" ? 0 : now(),
		});
	};
}
