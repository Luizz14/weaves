export const STARTUP_DIAGNOSTICS_CHANNEL = "startup-diagnostics:mark";
export const STARTUP_DIAGNOSTICS_ARGUMENT = "--superset-startup-diagnostics";

export const RENDERER_STARTUP_MARKERS = [
	"react-commit",
	"shell-interactive",
	"terminal-usable",
] as const;

export type RendererStartupMarker = (typeof RENDERER_STARTUP_MARKERS)[number];
export type StartupMarker =
	| "process-start"
	| "bootstrap-imports-end"
	| "app-ready"
	| "window-created"
	| "window-show"
	| RendererStartupMarker;
