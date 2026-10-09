import {
	HOST_STARTUP_MARKERS,
	type HostStartupMarker,
} from "@superset/shared/startup-markers";

export const STARTUP_DIAGNOSTICS_CHANNEL = "startup-diagnostics:mark";
export const STARTUP_DIAGNOSTICS_ARGUMENT = "--superset-startup-diagnostics";

export const MAIN_STARTUP_MARKERS = [
	"process-start",
	"bootstrap-imports-end",
	"shell-env-ready",
	"app-ready",
	"i18n-ready",
	"app-state-ready",
	"webview-extension-ready",
	"v1-terminal-reconciled",
	"bridge-ready",
	"host-reconcile-start",
	"host-start-cancelled",
	"agent-setup-end",
	"window-created",
	"ready-to-show",
	"did-finish-load",
	"window-show",
	"active-host-spawned",
	"active-host-healthy",
] as const;

export const RENDERER_STARTUP_MARKERS = [
	"react-commit",
	"router-ready",
	"query-cache-restored",
	"renderer-i18n-ready",
	"auth-hydrated",
	"session-resolved",
	"org-resolved",
	"collections-ready",
	"host-url-ready",
	"shell-interactive",
	"terminal-ws-open",
	"terminal-attached",
	"terminal-first-bytes",
	"terminal-usable",
] as const;

export { HOST_STARTUP_MARKERS };

export type MainStartupMarker = (typeof MAIN_STARTUP_MARKERS)[number];
export type RendererStartupMarker = (typeof RENDERER_STARTUP_MARKERS)[number];
export type StartupMarker =
	| MainStartupMarker
	| RendererStartupMarker
	| HostStartupMarker;

export const ALL_STARTUP_MARKERS: readonly StartupMarker[] = [
	"process-start",
	"bootstrap-imports-end",
	"shell-env-ready",
	"app-ready",
	"i18n-ready",
	"app-state-ready",
	"webview-extension-ready",
	"v1-terminal-reconciled",
	"bridge-ready",
	"host-reconcile-start",
	"active-host-spawned",
	"host-process-start",
	"host-imports-end",
	"host-db-ready",
	"host-app-created",
	"host-listening",
	"host-terminal-env-ready",
	"host-daemon-ready",
	"active-host-healthy",
	"host-start-cancelled",
	"agent-setup-end",
	"window-created",
	"ready-to-show",
	"window-show",
	"did-finish-load",
	"react-commit",
	"router-ready",
	"query-cache-restored",
	"renderer-i18n-ready",
	"auth-hydrated",
	"session-resolved",
	"org-resolved",
	"collections-ready",
	"host-url-ready",
	"shell-interactive",
	"terminal-ws-open",
	"host-first-attach-start",
	"host-first-attach-ready",
	"terminal-attached",
	"terminal-first-bytes",
	"terminal-usable",
];
