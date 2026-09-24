/**
 * Native dependencies that remain external to the Node sidecar bundle.
 *
 * The desktop no longer has an Electron runtime. Vite bundles the TypeScript
 * service and the Tauri bundle carries a private Node installation plus only
 * the native modules that service can load. Keeping this list explicit avoids
 * accidentally resolving a module from the repository's shared node_modules at
 * runtime.
 */

export const NODE_RUNTIME_VERSION = "24.15.0";
export const NODE_RUNTIME_EXECUTABLE = "node/bin/node";
export const RUNTIME_NODE_MODULES_DIRECTORY = "node_modules";
export const DESKTOP_SERVICE_ENTRY = "main/desktop-service.cjs";

export const nativeRuntimeModules = [
	"@anthropic-ai/claude-agent-sdk",
	"better-sqlite3",
	"node-pty",
	"native-keymap",
	"@superset/macos-process-metrics",
	"@ast-grep/napi",
	"@parcel/watcher",
	"@napi-rs/keyring",
	"sharp",
] as const;

// Runtime support packages are copied as independent directories into the
// sidecar's private node_modules tree.
export const nativeRuntimeSupportModules = [
	"bindings",
	"file-uri-to-path",
	"detect-libc",
	"is-glob",
	"is-extglob",
	"picomatch",
	"node-addon-api",
	"ws",
] as const;

export const runtimeModuleNames = [
	...nativeRuntimeModules,
	...nativeRuntimeSupportModules,
] as const;

// Vite must leave these modules as require() calls. The Node sidecar's
// isolated node_modules directory is staged by prepare-runtime-dependencies.
export const mainExternalizedDependencies = [
	...runtimeModuleNames,
	"pg-native",
];

export const requiredMaterializedNodeModules = [...runtimeModuleNames];

export function runtimeResourcePath(...parts: string[]): string {
	return ["dist", ...parts].join("/");
}
