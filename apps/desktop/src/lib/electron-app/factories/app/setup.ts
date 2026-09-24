import {
	getAllNativeWindows,
	getNativeWindow,
	onNativeEventNamed,
	type NativeWindowHandle,
} from "main/native/platform";

/**
 * Native equivalent of the legacy Electron app setup. Window activation and
 * external-navigation policy are owned by Rust; Node only restores windows
 * and forwards trusted lifecycle events to the supplied creator.
 */
export async function makeAppSetup(
	createWindow: () => Promise<NativeWindowHandle>,
	restoreWindows?: () => Promise<void>,
): Promise<NativeWindowHandle | null> {
	if (restoreWindows) await restoreWindows();
	let windows = getAllNativeWindows();
	if (windows.length === 0) windows = [await createWindow()];

	onNativeEventNamed("app:activate", () => {
		const current = getAllNativeWindows();
		if (current.length === 0) {
			void createWindow();
			return;
		}
		for (const window of current) {
			window.show();
			window.focus();
		}
	});
	onNativeEventNamed("window:created", (event) => {
		if (event.windowLabel) getNativeWindow(event.windowLabel);
	});

	return windows[0] ?? null;
}
