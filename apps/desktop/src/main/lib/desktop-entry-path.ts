import { join } from "node:path";
import {
	getNativeRuntimeMetadata,
	type NativeRuntimeMetadata,
} from "main/native/platform";

export type DesktopEntryRuntime = Pick<
	NativeRuntimeMetadata,
	"isPackaged" | "appPath" | "resourcePath"
>;

/**
 * Resolve an entry emitted by the desktop main Vite build.
 *
 * Main modules are split into chunks, so a module's `__dirname` is not a
 * reliable way to find a sibling process entry. Native bootstrap paths are
 * the source of truth: packaged entries live in Resources/main, while dev
 * entries live in the desktop app's dist/main directory.
 */
export function resolveDesktopEntryPath(
	entryName: string,
	runtime: DesktopEntryRuntime,
): string {
	if (
		!entryName ||
		entryName === "." ||
		entryName === ".." ||
		entryName.includes("/") ||
		entryName.includes("\\")
	) {
		throw new Error(`Invalid desktop entry name: ${entryName}`);
	}

	const mainDirectory = runtime.isPackaged
		? join(runtime.resourcePath, "main")
		: join(runtime.appPath, "dist", "main");
	return join(mainDirectory, entryName);
}

export function resolveNativeDesktopEntryPath(entryName: string): string {
	const runtime = getNativeRuntimeMetadata();
	if (!runtime) {
		throw new Error(
			`Native bootstrap is required to resolve desktop entry ${entryName}`,
		);
	}
	return resolveDesktopEntryPath(entryName, runtime);
}
