import {
	getAllNativeWindows,
	getFocusedNativeWindow,
	invokeNative,
	onNativeEventNamed,
} from "main/native/platform";

let skipQuitConfirmation = false;
let forceFullCleanup = false;

export function focusMainWindow(): void {
	const window = getFocusedNativeWindow() ?? getAllNativeWindows()[0];
	if (window) {
		window.show();
		window.focus();
	} else {
		void invokeNative("app.activate");
	}
}

export function setSkipQuitConfirmation(): void {
	skipQuitConfirmation = true;
	void invokeNative("app.setQuitConfirmation", { enabled: false }).catch(
		(error) => {
			console.warn(
				"[app] Native quit-confirmation state is unavailable:",
				error,
			);
		},
	);
}

export function quitApp(): void {
	setSkipQuitConfirmation();
	void invokeNative("app.quit", { force: false });
}

export function quitAppCompletely(): void {
	forceFullCleanup = true;
	setSkipQuitConfirmation();
	void invokeNative("app.quit", { force: true, fullCleanup: true });
}

export function exitImmediately(): void {
	void invokeNative("app.exit", { code: 0 });
}

export function shouldSkipQuitConfirmation(): boolean {
	return skipQuitConfirmation;
}

export function shouldForceFullCleanup(): boolean {
	return forceFullCleanup;
}

export function registerDeepLinkHandler(
	handler: (url: string) => void | Promise<void>,
): () => void {
	return onNativeEventNamed("app:deepLink", (event) => {
		if (typeof event.payload === "string") void handler(event.payload);
	});
}
