import { EventEmitter } from "node:events";
import {
	type NativeBootstrap,
	nativeBootstrapSchema,
} from "shared/native-bootstrap";
import { z } from "zod";
import type { StdioPeer } from "./stdio-peer/stdio-peer";

/**
 * Runtime information supplied by the native host during the Node bootstrap.
 *
 * The native side owns paths which are different between development and a
 * packaged application.  Keeping them in one immutable-ish object prevents
 * the Node service from reconstructing paths from Electron-only globals.
 */
export interface NativeRuntimeMetadata {
	schemaVersion: 1;
	appName: string;
	version: string;
	isPackaged: boolean;
	appPath: string;
	resourcePath: string;
	userDataPath: string;
	sessionDataPath: string;
	platform: NodeJS.Platform;
	arch: string;
	paths: {
		appPath: string;
		resourcePath: string;
		userDataPath: string;
		sessionDataPath: string;
		downloads: string;
	};
	preferredLanguages: string[];
	username?: string;
	runtime: "tauri";
	[key: string]: unknown;
}

export interface NativeWindowState {
	label?: string;
	id?: number;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	zoomLevel?: number;
	zoomFactor?: number;
	minimized?: boolean;
	maximized?: boolean;
	fullscreen?: boolean;
	focused?: boolean;
	destroyed?: boolean;
	url?: string;
	[key: string]: unknown;
}

export interface NativeDisplay {
	bounds: { x: number; y: number; width: number; height: number };
	workAreaSize: { width: number; height: number };
}

export interface NativeWindowOptions {
	label?: string;
	id?: string;
	title?: string;
	width?: number;
	height?: number;
	x?: number;
	y?: number;
	minWidth?: number;
	minHeight?: number;
	show?: boolean;
	backgroundColor?: string;
	center?: boolean;
	maximized?: boolean;
	movable?: boolean;
	resizable?: boolean;
	acceptFirstMouse?: boolean;
	alwaysOnTop?: boolean;
	autoHideMenuBar?: boolean;
	titleBarStyle?: string;
	frame?: boolean;
	trafficLightPosition?: { x: number; y: number };
	titleBarOverlay?: { color: string; symbolColor: string; height?: number };
	icon?: string;
	webPreferences?: Record<string, unknown>;
	url?: string;
	[key: string]: unknown;
}

export interface NativeDialogOptions {
	title?: string;
	defaultPath?: string;
	properties?: string[];
	filters?: Array<{ name: string; extensions: string[] }>;
	message?: string;
	detail?: string;
	buttons?: string[];
	defaultId?: number;
	cancelId?: number;
	type?: "none" | "info" | "error" | "question" | "warning";
	[key: string]: unknown;
}

export interface NativeOpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}

export interface NativeMessageBoxResult {
	response: number;
	checkboxChecked?: boolean;
}

export interface NativeEvent {
	name: string;
	payload: unknown;
	windowLabel?: string;
}

type NativeEventListener = (event: NativeEvent) => void;
type WindowEventListener = (...args: unknown[]) => void;

const platformEvents = new EventEmitter();
const windows = new Map<string, NativeWindowHandle>();
let peer: StdioPeer | null = null;
let unsubscribePeer: (() => void) | null = null;
let runtimeMetadata: NativeRuntimeMetadata | null = null;
let permissionSnapshot: Record<string, string | boolean> = {};
let displays: NativeDisplay[] = [];
let bootstrapResolve: ((metadata: NativeRuntimeMetadata) => void) | null = null;
let bootstrapReject: ((error: Error) => void) | null = null;
let bootstrapPromise: Promise<NativeRuntimeMetadata> | null = null;
let bootstrapError: Error | null = null;

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

const nativeWindowStateSchema = z
	.object({
		label: z.string().min(1),
		id: z.number().int().positive(),
		x: z.number().finite(),
		y: z.number().finite(),
		width: z.number().finite().positive(),
		height: z.number().finite().positive(),
		zoomLevel: z.number().finite(),
		zoomFactor: z.number().finite().positive(),
		minimized: z.boolean(),
		maximized: z.boolean(),
		fullscreen: z.boolean(),
		focused: z.boolean(),
		destroyed: z.boolean(),
		url: z.string().optional(),
	})
	.passthrough();

const nativeWindowEventSchema = z
	.object({
		label: z.string().min(1),
		id: z.number().int().positive().optional(),
		x: z.number().finite().optional(),
		y: z.number().finite().optional(),
		width: z.number().finite().positive().optional(),
		height: z.number().finite().positive().optional(),
		zoomLevel: z.number().finite().optional(),
		zoomFactor: z.number().finite().positive().optional(),
		minimized: z.boolean().optional(),
		maximized: z.boolean().optional(),
		fullscreen: z.boolean().optional(),
		focused: z.boolean().optional(),
		destroyed: z.boolean().optional(),
		url: z.string().optional(),
	})
	.passthrough();

const nativeDisplayEventSchema = z.object({
	displays: z.array(
		z.object({
			bounds: z.object({
				x: z.number().finite(),
				y: z.number().finite(),
				width: z.number().finite().positive(),
				height: z.number().finite().positive(),
			}),
			workAreaSize: z.object({
				width: z.number().finite().positive(),
				height: z.number().finite().positive(),
			}),
		}),
	),
});

const nativeOpenDialogResultSchema = z.object({
	canceled: z.boolean(),
	filePaths: z.array(z.string()),
});

const nativeMessageBoxResultSchema = z.object({
	response: z.number().int().nonnegative(),
	checkboxChecked: z.boolean().optional(),
});

function normalizeRuntimeMetadata(value: unknown): NativeRuntimeMetadata {
	const parsed: NativeBootstrap = nativeBootstrapSchema.parse(value);
	return {
		...parsed,
		version: parsed.appVersion,
		appPath: parsed.paths.appPath,
		resourcePath: parsed.paths.resourcePath,
		userDataPath: parsed.paths.userDataPath,
		sessionDataPath: parsed.paths.sessionDataPath,
	};
}

function resolveBootstrap(value: unknown): void {
	bootstrapError = null;
	runtimeMetadata = normalizeRuntimeMetadata(value);
	const permissions = asRecord(runtimeMetadata.permissions);
	permissionSnapshot = { ...permissionSnapshot };
	for (const [key, permission] of Object.entries(permissions)) {
		if (typeof permission === "string" || typeof permission === "boolean") {
			permissionSnapshot[key] = permission;
		}
	}
	bootstrapResolve?.(runtimeMetadata);
	bootstrapResolve = null;
	bootstrapReject = null;
	platformEvents.emit("bootstrap", runtimeMetadata);
}

function rejectBootstrap(error: Error): void {
	bootstrapError = error;
	bootstrapReject?.(error);
	bootstrapResolve = null;
	bootstrapReject = null;
}

function updateWindowFromEvent(event: NativeEvent): void {
	const payload = asRecord(event.payload);
	const label = event.windowLabel ?? asString(payload.label, "");
	if (!label) return;
	let state: NativeWindowState;
	try {
		state = nativeWindowEventSchema.parse({ ...payload, label });
	} catch (error) {
		platformEvents.emit("native-error", {
			name: event.name,
			payload: error,
		});
		return;
	}
	const window = getNativeWindow(label, state);
	window.applyState(state);

	if (event.name === "window:closed" || event.name === "window:destroyed") {
		window.applyState({ destroyed: true, label });
	}
	if (event.name === "window:focus" && state.focused !== false) {
		for (const candidate of windows.values())
			candidate.applyState({ focused: false });
		window.applyState({ focused: true });
	}
	window.emitNativeEvent(event.name.slice("window:".length), event.payload);
}

function receiveNativeEvent(event: NativeEvent): void {
	if (event.name === "bootstrap") {
		try {
			resolveBootstrap(event.payload);
		} catch (error) {
			rejectBootstrap(
				error instanceof Error
					? error
					: new Error("Invalid native bootstrap payload"),
			);
			platformEvents.emit("bootstrap-error", error);
		}
	} else if (event.name === "display:changed") {
		const parsed = nativeDisplayEventSchema.safeParse(event.payload);
		if (parsed.success) displays = parsed.data.displays;
	} else if (event.name.startsWith("window:")) {
		updateWindowFromEvent(event);
	}
	platformEvents.emit("event", event);
}

/**
 * Attach the process stdio transport.  The desktop service calls this before
 * waiting for bootstrap, while tests and embedders can provide another peer.
 */
export function attachNativePeer(nextPeer: StdioPeer): void {
	if (peer && peer !== nextPeer) {
		unsubscribePeer?.();
	}
	peer = nextPeer;
	unsubscribePeer = nextPeer.subscribe(receiveNativeEvent);
	if (runtimeMetadata) {
		platformEvents.emit("bootstrap", runtimeMetadata);
	}
}

/** Detach the transport during an orderly service shutdown. */
export function detachNativePeer(): void {
	unsubscribePeer?.();
	unsubscribePeer = null;
	peer = null;
	bootstrapResolve = null;
	bootstrapReject = null;
}

/**
 * Wait for the trusted native bootstrap event.  A timeout is intentional: a
 * service that starts without paths or app identity would otherwise look
 * healthy while corrupting local state.
 */
export function waitForNativeBootstrap(
	timeoutMs = 30_000,
): Promise<NativeRuntimeMetadata> {
	if (bootstrapError) return Promise.reject(bootstrapError);
	if (runtimeMetadata) return Promise.resolve(runtimeMetadata);
	if (!bootstrapPromise) {
		bootstrapPromise = new Promise<NativeRuntimeMetadata>((resolve, reject) => {
			bootstrapResolve = resolve;
			bootstrapReject = reject;
		});
	}
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return bootstrapPromise;
	return Promise.race([
		bootstrapPromise,
		new Promise<NativeRuntimeMetadata>((_, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Native bootstrap timed out"));
			}, timeoutMs);
			bootstrapPromise?.finally(() => clearTimeout(timer));
		}),
	]);
}

/** Current native runtime metadata, if bootstrap has completed. */
export function getNativeRuntimeMetadata(): NativeRuntimeMetadata | null {
	return runtimeMetadata;
}

/** Resolve a native app path without relying on Electron's app.getPath. */
export function getNativePath(name: string): string {
	const metadata = runtimeMetadata;
	if (!metadata)
		throw new Error(`Native bootstrap is required for path ${name}`);
	const pathMap: Record<string, string> = {
		app: metadata.paths.appPath,
		appPath: metadata.paths.appPath,
		resources: metadata.paths.resourcePath,
		resourcePath: metadata.paths.resourcePath,
		userData: metadata.paths.userDataPath,
		userDataPath: metadata.paths.userDataPath,
		sessionData: metadata.paths.sessionDataPath,
		sessionDataPath: metadata.paths.sessionDataPath,
		downloads: metadata.paths.downloads,
	};
	const value = pathMap[name];
	if (!value) throw new Error(`Native bootstrap does not provide path ${name}`);
	return value;
}

export function getNativeAppName(): string {
	if (!runtimeMetadata)
		throw new Error("Native bootstrap is required for app name");
	return runtimeMetadata.appName;
}

export function getNativeAppVersion(): string {
	if (!runtimeMetadata)
		throw new Error("Native bootstrap is required for app version");
	return runtimeMetadata.version;
}

export function getNativePreferredSystemLanguages(): string[] {
	const value = runtimeMetadata?.preferredLanguages;
	return Array.isArray(value)
		? value.filter(
				(language): language is string => typeof language === "string",
			)
		: [];
}

export function isNativePackaged(): boolean {
	if (!runtimeMetadata)
		throw new Error("Native bootstrap is required for packaging state");
	return runtimeMetadata.isPackaged;
}

export function getNativePermissionSnapshot(): Record<
	string,
	string | boolean
> {
	return { ...permissionSnapshot };
}

export function getNativeDisplaySnapshot(): NativeDisplay[] {
	return displays.map((display) => ({
		bounds: { ...display.bounds },
		workAreaSize: { ...display.workAreaSize },
	}));
}

/** Subscribe to lifecycle/native events from Rust. */
export function onNativeEvent(listener: NativeEventListener): () => void {
	platformEvents.on("event", listener);
	return () => platformEvents.off("event", listener);
}

/** Subscribe to one named native event. */
export function onNativeEventNamed(
	name: string,
	listener: (event: NativeEvent) => void,
): () => void {
	const wrapped = (event: NativeEvent) => {
		if (event.name === name) listener(event);
	};
	return onNativeEvent(wrapped);
}

/**
 * Invoke a native command over the Rust-owned transport.  This is deliberately
 * the only Node-to-native entry point; callers must use a descriptive method
 * and a JSON-serializable parameter object. `windowLabel` is trusted transport
 * context and is intentionally kept out of `params`.
 */
export async function invokeNative<T>(
	method: string,
	params?: unknown,
	timeoutMs: number | null = 30_000,
	windowLabel?: string,
): Promise<T> {
	if (!peer) throw new Error(`Native transport is unavailable for ${method}`);
	return (await peer.request(
		method,
		params ?? null,
		timeoutMs,
		windowLabel,
	)) as T;
}

function windowNumber(label: string): number {
	let hash = 0;
	for (let index = 0; index < label.length; index++) {
		hash = (hash * 31 + label.charCodeAt(index)) | 0;
	}
	return Math.abs(hash) || 1;
}

export class NativeWebContents {
	readonly id: number;
	readonly ownerLabel: string;
	private readonly listeners = new Map<string, Set<WindowEventListener>>();
	private url = "";
	private zoomLevel = Number.NaN;

	constructor(private readonly owner: NativeWindowHandle) {
		this.id = owner.webContentsId;
		this.ownerLabel = owner.label;
	}

	applyState(state: NativeWindowState): void {
		if (typeof state.url === "string") this.url = state.url;
		if (typeof state.zoomLevel === "number") this.zoomLevel = state.zoomLevel;
		if (typeof state.zoomFactor === "number") {
			this.zoomLevel = Math.log(state.zoomFactor) / Math.log(1.2);
		}
	}

	on(event: string, listener: WindowEventListener): this {
		let listeners = this.listeners.get(event);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(event, listeners);
		}
		listeners.add(listener);
		return this;
	}

	off(event: string, listener: WindowEventListener): this {
		this.listeners.get(event)?.delete(listener);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) listener(...args);
	}

	getURL(): string {
		return this.url;
	}

	getZoomLevel(): number {
		if (!Number.isFinite(this.zoomLevel)) {
			throw new Error(`Window ${this.owner.label} has no native zoom snapshot`);
		}
		return this.zoomLevel;
	}

	getZoomFactor(): number {
		return 1.2 ** this.getZoomLevel();
	}

	async setZoomLevel(level: number): Promise<void> {
		this.zoomLevel = level;
		await invokeNative(
			"window.setZoomLevel",
			{
				level,
			},
			30_000,
			this.owner.label,
		);
	}

	setBackgroundThrottling(enabled: boolean): void {
		void invokeNative(
			"window.setBackgroundThrottling",
			{
				enabled,
			},
			30_000,
			this.owner.label,
		);
	}

	invalidate(): void {
		void invokeNative("window.invalidate", {}, 30_000, this.owner.label);
	}

	reload(): void {
		void invokeNative("window.reload", {}, 30_000, this.owner.label);
	}

	reloadIgnoringCache(): void {
		void invokeNative(
			"window.reloadIgnoringCache",
			{},
			30_000,
			this.owner.label,
		);
	}

	send(channel: string, ...args: unknown[]): void {
		void invokeNative(
			"window.sendEvent",
			{
				name: channel,
				payload: args,
			},
			30_000,
			this.owner.label,
		);
	}

	setWindowOpenHandler(_handler: unknown): void {
		void invokeNative(
			"window.setOpenPolicy",
			{
				policy: "native",
			},
			30_000,
			this.owner.label,
		);
	}

	setWindowOpenHandlerResult(_result: unknown): void {
		void invokeNative(
			"window.setOpenPolicy",
			{
				policy: "native",
			},
			30_000,
			this.owner.label,
		);
	}

	setURL(url: string): void {
		this.url = url;
	}
}

/**
 * A native window handle.  It intentionally mirrors only the small surface
 * used by desktop business code; every mutating operation is a real native
 * command, while state getters use the last trusted Rust event snapshot.
 */
export class NativeWindowHandle {
	readonly id: number;
	readonly webContentsId: number;
	readonly webContents: NativeWebContents;
	private readonly listeners = new Map<string, Set<WindowEventListener>>();
	private state: NativeWindowState;

	constructor(
		readonly label: string,
		initialState: NativeWindowState = { label },
	) {
		this.id = initialState.id ?? windowNumber(label);
		this.webContentsId = this.id;
		this.state = {
			...initialState,
			label,
		};
		this.webContents = new NativeWebContents(this);
		this.webContents.applyState(this.state);
	}

	applyState(state: NativeWindowState): void {
		this.state = { ...this.state, ...state, label: this.label };
		this.webContents.applyState(this.state);
	}

	emitNativeEvent(event: string, payload: unknown): void {
		this.webContents.emit(event, payload);
		for (const listener of this.listeners.get(event) ?? []) listener(payload);
	}

	on(event: string, listener: WindowEventListener): this {
		let listeners = this.listeners.get(event);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(event, listeners);
		}
		listeners.add(listener);
		return this;
	}

	off(event: string, listener: WindowEventListener): this {
		this.listeners.get(event)?.delete(listener);
		return this;
	}

	isDestroyed(): boolean {
		return this.state.destroyed === true;
	}

	isMinimized(): boolean {
		return this.state.minimized === true;
	}

	isMaximized(): boolean {
		return this.state.maximized === true;
	}

	isFullScreen(): boolean {
		return this.state.fullscreen === true;
	}

	isFocused(): boolean {
		return this.state.focused === true;
	}

	show(): void {
		this.state.minimized = false;
		void invokeNative("window.show", {}, 30_000, this.label);
	}

	hide(): void {
		void invokeNative("window.hide", {}, 30_000, this.label);
	}

	focus(): void {
		this.state.focused = true;
		void invokeNative("window.focus", {}, 30_000, this.label);
	}

	restore(): void {
		this.state.minimized = false;
		void invokeNative("window.restore", {}, 30_000, this.label);
	}

	minimize(): void {
		this.state.minimized = true;
		void invokeNative("window.minimize", {}, 30_000, this.label);
	}

	maximize(): void {
		this.state.maximized = true;
		void invokeNative("window.maximize", {}, 30_000, this.label);
	}

	unmaximize(): void {
		this.state.maximized = false;
		void invokeNative("window.unmaximize", {}, 30_000, this.label);
	}

	close(): void {
		void invokeNative("window.close", {}, 30_000, this.label);
	}

	getBounds(): { x: number; y: number; width: number; height: number } {
		if (
			!Number.isFinite(this.state.x) ||
			!Number.isFinite(this.state.y) ||
			!Number.isFinite(this.state.width) ||
			!Number.isFinite(this.state.height)
		) {
			throw new Error(`Window ${this.label} has no native bounds snapshot`);
		}
		return {
			x: this.state.x as number,
			y: this.state.y as number,
			width: this.state.width as number,
			height: this.state.height as number,
		};
	}

	getNormalBounds(): { x: number; y: number; width: number; height: number } {
		return this.getBounds();
	}

	getSize(): [number, number] {
		const bounds = this.getBounds();
		return [bounds.width, bounds.height];
	}

	setSize(width: number, height: number): void {
		this.state.width = width;
		this.state.height = height;
		void invokeNative(
			"window.setSize",
			{
				width,
				height,
			},
			30_000,
			this.label,
		);
	}

	async setTitleBarOverlay(options: {
		color?: string;
		symbolColor?: string;
		height?: number;
	}): Promise<void> {
		return invokeNative(
			"window.setTitleBarOverlay",
			{
				...options,
			},
			30_000,
			this.label,
		);
	}

	get title(): string {
		return asString(this.state.title, "Superset");
	}

	setTitle(title: string): void {
		this.state.title = title;
		void invokeNative("window.setTitle", { title }, 30_000, this.label);
	}
}

/** Get or create the trusted handle represented by a Rust window label. */
export function getNativeWindow(
	label: string,
	initialState: NativeWindowState = { label },
): NativeWindowHandle {
	let window = windows.get(label);
	if (!window) {
		window = new NativeWindowHandle(label, initialState);
		windows.set(label, window);
	} else {
		window.applyState(initialState);
	}
	return window;
}

/** Register a native window after Rust creates it. */
export function registerNativeWindow(
	state: NativeWindowState & { label: string },
): NativeWindowHandle {
	return getNativeWindow(state.label, state);
}

export function unregisterNativeWindow(label: string): void {
	const window = windows.get(label);
	if (window) window.applyState({ destroyed: true, label });
	windows.delete(label);
}

export function getAllNativeWindows(): NativeWindowHandle[] {
	return [...windows.values()].filter((window) => !window.isDestroyed());
}

export function getFocusedNativeWindow(): NativeWindowHandle | null {
	return getAllNativeWindows().find((window) => window.isFocused()) ?? null;
}

export async function createNativeWindow(
	options: NativeWindowOptions,
): Promise<NativeWindowHandle> {
	const result = nativeWindowStateSchema.parse(
		await invokeNative<unknown>("window.create", options),
	);
	const label = result.label;
	return registerNativeWindow({ ...result, label });
}

export async function openNativeDialog(
	options: NativeDialogOptions,
	windowLabel?: string,
): Promise<NativeOpenDialogResult> {
	return nativeOpenDialogResultSchema.parse(
		await invokeNative<unknown>("dialog.open", options, null, windowLabel),
	);
}

export async function showNativeMessageBox(
	options: NativeDialogOptions,
	windowLabel?: string,
): Promise<NativeMessageBoxResult> {
	return nativeMessageBoxResultSchema.parse(
		await invokeNative<unknown>("dialog.message", options, null, windowLabel),
	);
}

export function resetNativePlatformForTests(): void {
	detachNativePeer();
	runtimeMetadata = null;
	permissionSnapshot = {};
	displays = [];
	bootstrapPromise = null;
	bootstrapError = null;
	windows.clear();
}
