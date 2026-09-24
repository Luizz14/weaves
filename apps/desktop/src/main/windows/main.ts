import { randomUUID } from "node:crypto";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import {
	isAppStateInitialized,
	pruneWindowScopedState,
} from "main/lib/app-state";
import { resolveDevWorkspaceName } from "main/lib/dev-workspace-name";
import { createApplicationMenu } from "main/lib/menu";
import { menuEmitter } from "main/lib/menu-events";
import {
	getAllWindows,
	getFocusedOrLastWindow,
	getKey,
	getOrg,
	markFocused,
	registerWindow,
	unregisterWindow,
} from "main/lib/window-registry/window-registry";
import {
	getInitialWindowBounds,
	loadWindowState,
	loadWindows,
	type PersistedWindow,
	saveWindowState,
	saveWindows,
	toNativeWindowStateParams,
	type WindowState,
} from "main/lib/window-state";
import {
	createNativeWindow,
	getAllNativeWindows,
	getNativeRuntimeMetadata,
	invokeNative,
	type NativeWindowHandle,
	onNativeEventNamed,
} from "main/native/platform";
import { productName } from "~/package.json";

let appServicesInitialized = false;
let appQuitting = false;

function fallbackWorkspaceName(): string {
	return i18n._(msg({ message: "Workspace" }));
}

function getWindowTitle(): string {
	const workspaceName =
		process.env.NODE_ENV === "development"
			? resolveDevWorkspaceName()
			: undefined;
	return workspaceName ? `${productName} — ${workspaceName}` : productName;
}

function snapshotWindow(window: NativeWindowHandle): WindowState {
	const bounds = window.getNormalBounds();
	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		isMaximized: window.isMaximized(),
		zoomLevel: window.webContents.getZoomLevel(),
	};
}

export function initAppServices(): void {
	if (appServicesInitialized) return;
	appServicesInitialized = true;
	createApplicationMenu();
	menuEmitter.on("new-window", (payload?: { orgId?: string | null }) => {
		const focused = getFocusedOrLastWindow();
		const orgId =
			payload && "orgId" in payload
				? (payload.orgId ?? null)
				: focused
					? getOrg(focused.id)
					: null;
		void createPlatformWindow({ orgId }).catch((error) => {
			console.error("[main-window] Failed to open new window:", error);
		});
	});
	onNativeEventNamed("window:created", (event) => {
		if (!event.windowLabel) return;
		const window = getAllNativeWindows().find(
			(candidate) => candidate.label === event.windowLabel,
		);
		if (
			window &&
			!getAllWindows().some((candidate) => candidate.id === window.id)
		) {
			registerWindow({ window, orgId: null, key: randomUUID() });
		}
	});
}

export function markAppQuitting(): void {
	appQuitting = true;
}

export function persistOpenWindows(): void {
	if (!isAppStateInitialized()) return;
	const windows = getAllWindows().filter((window) => !window.isDestroyed());
	const persisted: PersistedWindow[] = windows.map((window) => ({
		key: getKey(window.id) ?? randomUUID(),
		orgId: getOrg(window.id),
		state: snapshotWindow(window),
	}));
	pruneWindowScopedState(persisted.map((window) => window.key));
	saveWindows(persisted);
}

export async function restoreWindows(): Promise<void> {
	let persistedWindows = loadWindows();
	const existingWindows = getAllNativeWindows();
	if (existingWindows.length > 0) {
		const firstWindow = existingWindows[0];
		if (!firstWindow) return;
		if (persistedWindows.length === 0) {
			for (const window of existingWindows) {
				registerWindow({ window, orgId: null, key: randomUUID() });
			}
			return;
		}
		for (const [index, window] of existingWindows.entries()) {
			const persisted = persistedWindows[index];
			if (!persisted) break;
			registerWindow({
				window,
				orgId: persisted.orgId,
				key: persisted.key,
			});
			await invokeNative(
				"window.restoreState",
				toNativeWindowStateParams(persisted.state),
				30_000,
				window.label,
			);
		}
		persistedWindows = persistedWindows.slice(existingWindows.length);
	}
	for (const persisted of persistedWindows) {
		await createPlatformWindow({
			orgId: persisted.orgId,
			bounds: persisted.state,
			key: persisted.key,
		});
	}
}

export function titleBarOverlayColors(): {
	color: string;
	symbolColor: string;
	height: number;
} {
	const dark = getNativeRuntimeMetadata()?.darkMode === true;
	return {
		color: dark ? "#252525" : "#ffffff",
		symbolColor: dark ? "#e5e5e5" : "#1f1f1f",
		height: 40,
	};
}

export async function createPlatformWindow({
	orgId,
	bounds,
	key,
}: {
	orgId: string | null;
	bounds?: WindowState;
	key?: string;
}): Promise<NativeWindowHandle> {
	initAppServices();
	const saved =
		bounds ?? (getAllWindows().length === 0 ? loadWindowState() : null);
	const initial = getInitialWindowBounds(saved);
	const label = key ? `main-${key}` : `main-${randomUUID()}`;
	const windowKey = key ?? randomUUID();
	const window = await createNativeWindow({
		id: label,
		label,
		key: windowKey,
		orgId,
		title: getWindowTitle(),
		width: initial.width,
		height: initial.height,
		x: initial.x,
		y: initial.y,
		maximized: initial.isMaximized,
		minWidth: 400,
		minHeight: 400,
		show: true,
		center: initial.center,
		resizable: true,
		movable: true,
		titleBarOverlay: titleBarOverlayColors(),
	});
	registerWindow({ window, orgId, key: windowKey });
	window.on("focus", () => {
		markFocused(window.id);
	});
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const save = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			if (window.isDestroyed()) return;
			saveWindowState(snapshotWindow(window));
			persistOpenWindows();
		}, 500);
	};
	window.on("move", save);
	window.on("moved", save);
	window.on("resize", save);
	window.on("resized", save);
	window.on("zoom-changed", save);
	window.on("closed", () => {
		if (!appQuitting) saveWindowState(snapshotWindow(window));
		unregisterWindow(window.id);
		if (!appQuitting) persistOpenWindows();
	});
	return window;
}

export function getDefaultWindowTitle(): string {
	return fallbackWorkspaceName();
}
