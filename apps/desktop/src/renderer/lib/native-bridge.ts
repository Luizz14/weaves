import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import {
	type NativeBootstrap,
	nativeBootstrapSchema,
} from "shared/native-bootstrap";
import {
	DESKTOP_NATIVE_EVENT,
	type DesktopNativeEvent,
	type DesktopRpcMessage,
} from "shared/native-rpc";

export type DesktopRuntimeMetadata = {
	appVersion: string;
	platform: string;
	username?: string;
};

export type AppBridge = {
	sayHelloFromBridge: () => void;
	username?: string;
	appVersion: string;
	platform: string;
};

type DesktopEventListener = (payload: unknown) => void;
type BootstrapResolver = () => void;
type BootstrapRejecter = (error: Error) => void;

export type DesktopRuntime = "tauri" | "electron" | "browser";
export const DESKTOP_SERVICE_DISCONNECTED = "native:disconnected";
export const DESKTOP_SERVICE_DISCONNECTED_LEGACY = "service:disconnected";

const desktopEventListeners = new Map<string, Set<DesktopEventListener>>();
let droppedPaths: string[] = [];

let desktopEventUnlisten: UnlistenFn | null = null;
let dragDropUnlisten: UnlistenFn | null = null;
let initialization: Promise<void> | null = null;
let runtimeMetadata: DesktopRuntimeMetadata | null = null;
let resolveBootstrap: BootstrapResolver | null = null;
let rejectBootstrap: BootstrapRejecter | null = null;
let bootstrapReady: Promise<void> | null = null;

const appBridgeMethods = {
	sayHelloFromBridge: () => {
		console.log("[desktop] bridge is available");
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function detectDesktopRuntime(): DesktopRuntime {
	const global = globalThis as Record<string, unknown>;
	if ("__TAURI_INTERNALS__" in global || "__TAURI__" in global) {
		return "tauri";
	}
	const processValue = global.process;
	if (isRecord(processValue) && isRecord(processValue.versions)) {
		if (typeof processValue.versions.electron === "string") return "electron";
	}
	return "browser";
}

function metadataFromPayload(payload: unknown): DesktopRuntimeMetadata {
	const bootstrap: NativeBootstrap = nativeBootstrapSchema.parse(payload);
	return {
		appVersion: bootstrap.appVersion,
		platform: bootstrap.platform,
		...(bootstrap.username ? { username: bootstrap.username } : {}),
	};
}

function installAppBridge(metadata: DesktopRuntimeMetadata): void {
	runtimeMetadata = metadata;
	if (typeof window === "undefined") return;
	window.App = {
		...appBridgeMethods,
		...metadata,
	};
}

function dispatchDesktopEvent(event: DesktopNativeEvent): void {
	if (
		event.name === DESKTOP_SERVICE_DISCONNECTED ||
		event.name === DESKTOP_SERVICE_DISCONNECTED_LEGACY
	) {
		runtimeMetadata = null;
		initialization = null;
		bootstrapReady = null;
		bootstrapError = new Error(
			"Desktop service disconnected; reload Superset to reconnect",
		);
		rejectBootstrap?.(bootstrapError);
		resolveBootstrap = null;
		rejectBootstrap = null;
	}
	if (event.name === "bootstrap") {
		try {
			const metadata = metadataFromPayload(event.payload);
			bootstrapError = null;
			installAppBridge(metadata);
			resolveBootstrap?.();
			resolveBootstrap = null;
			rejectBootstrap = null;
		} catch (error) {
			bootstrapError =
				error instanceof Error
					? error
					: new Error("Invalid native bootstrap payload");
			rejectBootstrap?.(bootstrapError);
			resolveBootstrap = null;
			rejectBootstrap = null;
		}
	}

	const listeners = desktopEventListeners.get(event.name);
	if (!listeners) return;
	for (const listener of listeners) listener(event.payload);
}

function addDroppedPath(path: string): void {
	const normalizedPath = path.trim();
	if (!normalizedPath) return;
	droppedPaths.push(normalizedPath);
}

function clearDroppedPaths(): void {
	droppedPaths = [];
}

function pathFromFile(file: File): string {
	const fileWithPath = file as File & { path?: unknown };
	if (typeof fileWithPath.path === "string" && fileWithPath.path.length > 0) {
		return fileWithPath.path;
	}

	const path = droppedPaths[0];
	const nativeName = path?.split(/[\\/]/).at(-1);
	if (path && nativeName === file.name) {
		droppedPaths.shift();
		return path;
	}

	throw new Error(
		`Native path unavailable for dropped file ${JSON.stringify(file.name)}; drop order did not match native paths`,
	);
}

function handleDragDropEvent(event: DragDropEvent): void {
	if (event.type === "drop") {
		clearDroppedPaths();
		for (const path of event.paths) addDroppedPath(path);
		return;
	}
	if (event.type === "leave") clearDroppedPaths();
}

export function getNativeFilePath(file: File): string {
	return pathFromFile(file);
}

let bootstrapError: Error | null = null;

function waitForBootstrap(): Promise<void> {
	if (bootstrapError) return Promise.reject(bootstrapError);
	if (runtimeMetadata) return Promise.resolve();
	if (!bootstrapReady) {
		bootstrapReady = new Promise<void>((resolve, reject) => {
			resolveBootstrap = resolve;
			rejectBootstrap = reject;
		});
	}
	return Promise.race([
		bootstrapReady,
		new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error("Desktop bootstrap metadata was not received")),
				5_000,
			);
		}),
	]);
}

export function subscribeDesktopEvent(
	name: string,
	listener: DesktopEventListener,
): () => void {
	let listeners = desktopEventListeners.get(name);
	if (!listeners) {
		listeners = new Set();
		desktopEventListeners.set(name, listeners);
	}
	listeners.add(listener);
	return () => unsubscribeDesktopEvent(name, listener);
}

export function unsubscribeDesktopEvent(
	name: string,
	listener: DesktopEventListener,
): void {
	const listeners = desktopEventListeners.get(name);
	if (!listeners) return;
	listeners.delete(listener);
	if (listeners.size === 0) desktopEventListeners.delete(name);
}

export function initializeDesktopBridge(): Promise<void> {
	if (initialization) return initialization;

	initialization = (async () => {
		bootstrapError = null;
		if (detectDesktopRuntime() !== "tauri") {
			throw new Error("Tauri runtime is unavailable");
		}

		if (!desktopEventUnlisten) {
			desktopEventUnlisten = await listen<DesktopNativeEvent>(
				DESKTOP_NATIVE_EVENT,
				(event) => {
					if (!isRecord(event.payload)) return;
					const name = event.payload.name;
					if (typeof name !== "string") return;
					dispatchDesktopEvent({
						name,
						payload: event.payload.payload,
					});
				},
			);
		}
		if (!runtimeMetadata) {
			const replay = await invoke<unknown>("native_command", {
				method: "app.bootstrap",
				params: null,
			});
			dispatchDesktopEvent({ name: "bootstrap", payload: replay });
		}
		await waitForBootstrap();

		if (!dragDropUnlisten) {
			dragDropUnlisten = await getCurrentWebview().onDragDropEvent(
				(event: { payload: DragDropEvent }) =>
					handleDragDropEvent(event.payload),
			);
		}
	})().catch((error: unknown) => {
		initialization = null;
		throw error;
	});

	return initialization;
}

export async function disposeDesktopBridge(): Promise<void> {
	const unlisten = [desktopEventUnlisten, dragDropUnlisten].filter(
		(value): value is UnlistenFn => value !== null,
	);
	desktopEventUnlisten = null;
	dragDropUnlisten = null;
	initialization = null;
	runtimeMetadata = null;
	bootstrapError = null;
	bootstrapReady = null;
	resolveBootstrap = null;
	rejectBootstrap = null;
	for (const dispose of unlisten) await dispose();
	for (const listeners of desktopEventListeners.values()) listeners.clear();
	desktopEventListeners.clear();
	clearDroppedPaths();
}

export async function desktopRpc(message: DesktopRpcMessage): Promise<unknown> {
	await initializeDesktopBridge();
	return invoke("desktop_rpc", { message });
}

export async function invokeNative<T>(
	method: string,
	params?: unknown,
): Promise<T> {
	await initializeDesktopBridge();
	return invoke<T>("native_command", { method, params: params ?? null });
}

export function getRuntimeMetadata(): DesktopRuntimeMetadata {
	if (!runtimeMetadata) {
		throw new Error("Desktop bootstrap metadata is unavailable");
	}
	return { ...runtimeMetadata };
}
