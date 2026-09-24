import { invokeNative, onNativeEvent } from "main/native/platform";

/**
 * The browser bridge deliberately has one narrow transport.  Browser content
 * never receives this function: calls originate in the trusted Node host and
 * are forwarded by the native shell with its already-authenticated caller
 * label.
 */
export function dispatchNativeBrowser<T>(
	method: string,
	params?: unknown,
	windowLabel?: string,
): Promise<T> {
	return invokeNative<T>(method, params, 30_000, windowLabel);
}

export interface NativeBrowserPane {
	paneId: string;
	workspaceId: string | null;
	url: string;
	title: string;
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	zoomFactor: number;
}

export interface NativeBrowserCapture {
	base64: string;
	url: string;
	width?: number;
	height?: number;
}

export interface NativeBrowserEvent {
	paneId?: string;
	workspaceId?: string | null;
	kind: string;
	[key: string]: unknown;
}

export function subscribeNativeBrowserEvents(
	listener: (event: NativeBrowserEvent) => void,
): () => void {
	return onNativeEvent((event) => {
		if (event.name !== "browser:event") return;
		if (!event.payload || typeof event.payload !== "object") return;
		listener({
			...(event.payload as NativeBrowserEvent),
			...(event.windowLabel ? { ownerLabel: event.windowLabel } : {}),
		});
	});
}

export function subscribeNativeMenuEvents(
	listener: (payload: unknown, windowLabel?: string) => void,
): () => void {
	return onNativeEvent((event) => {
		if (event.name !== "menu:contextAction") return;
		listener(event.payload, event.windowLabel);
	});
}
