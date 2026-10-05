import type { RendererStartupMarker } from "shared/startup-diagnostics";

const recorded = new Set<RendererStartupMarker>();

export function markRendererStartup(marker: RendererStartupMarker) {
	if (!window.App?.startupDiagnostics || recorded.has(marker)) return;
	recorded.add(marker);
	window.App.startupDiagnostics(marker);
}
