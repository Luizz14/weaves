/**
 * CEF does not load Chrome extensions, so the React DevTools extension cannot
 * be the renderer inspector. The inline backend installs the same React hook
 * in the page and is consumed by the inline/standalone DevTools frontend in
 * development builds.
 *
 * This module is imported before React from the renderer entrypoint. The
 * backend must install its hook before React creates a root.
 */
import { initialize } from "react-devtools-inline/backend";

let initialized = false;

export function initializeReactDevToolsBackend(): void {
	if (initialized || process.env.NODE_ENV === "production") return;
	initialize(window);
	initialized = true;
}
