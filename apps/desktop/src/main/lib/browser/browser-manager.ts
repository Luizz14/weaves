import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PROTOCOL_SCHEMES } from "@superset/shared/constants";
import { getNativePath } from "main/native/platform";
import type {
	DesignModeRect,
	DesignModeScreenshot,
	DesignModeSelectionResult,
} from "shared/browser-design-mode";
import { PROTOCOL_SCHEME } from "shared/constants";
import { chordFromInput, type ForwardedKey } from "shared/hotkey-chord";
import {
	forwardSessionFor,
	handleTargetCommand,
	type ShimIds,
	shimIds,
	tagEventSession,
} from "./cdp-target-shim";
import {
	type CookieKeychainIdentity,
	type ImportedCookie,
	readCookiesFromProfileWithStatus,
} from "./chrome-cookie-import";
import { resolveImportProfile } from "./chrome-history-import";
import {
	type BrowserGuest,
	DesignModeController,
} from "./design-mode-controller";
import {
	dispatchNativeBrowser,
	type NativeBrowserCapture,
	type NativeBrowserEvent,
	type NativeBrowserPane,
	subscribeNativeBrowserEvents,
	subscribeNativeMenuEvents,
} from "./native-browser";

export interface BrowserPaneInfo extends NativeBrowserPane {}

export interface BrowserOpenRequest {
	workspaceId: string;
	projectId: string | null;
	url: string;
	target: "current-tab" | "new-tab";
	show: boolean;
	requestId: string;
}

export interface BrowserRegisterOptions {
	workspaceId?: string;
	url?: string;
	visible?: boolean;
	bounds?: BrowserBounds;
}

export interface BrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BrowserScreenshot extends NativeBrowserCapture {}

export interface CdpSession {
	send: (rawMessage: string) => void;
	detach: () => void;
}

export class CdpBusyError extends Error {}

const DEFAULT_BROWSER_URL = "about:blank";
const LEGACY_GUEST_SNAPSHOT = [
	"migration",
	"electron-guest-partition",
] as const;
const LEGACY_COOKIE_IMPORT_MARKER = [
	"migration",
	"browser-cookies-imported.json",
] as const;
const LEGACY_GUEST_METADATA = "metadata.json";

interface LegacyCookieImportResult {
	imported: number;
	skipped: number;
	keyUnavailable: boolean;
	snapshotAvailable: boolean;
}

interface ImportedCookieWriteResult {
	imported: number;
	skipped: number;
	keyUnavailable?: boolean;
}
const ALLOWED_GUEST_SCHEMES = new Set(["http:", "https:", "about:"]);
const DEEP_LINK_SCHEMES = new Set([
	`${PROTOCOL_SCHEMES.PROD}:`,
	`${PROTOCOL_SCHEME}:`,
]);
const MAX_CONSOLE_ENTRIES = 500;

interface PaneRegistration extends BrowserPaneInfo {
	ownerLabel: string;
}

interface PaneRegistrationTask {
	ownerLabel: string;
	workspaceId: string | null;
	promise: Promise<{ success: true; pane: BrowserPaneInfo }>;
}

interface GuestListener {
	event: string;
	listener: (...args: unknown[]) => void;
}

interface CdpRegistration {
	sessionId: string;
	ids: ShimIds;
	flatSessionId: string | null;
	autoAttachEmitted: boolean;
	onMessage: (payload: string) => void;
	onDetach: (reason: string) => void;
	closed: boolean;
}

interface ConsoleEntry {
	level: "log" | "warn" | "error" | "info" | "debug";
	message: string;
	timestamp: number;
}

function sanitizeUrl(url: string): string {
	if (/^https?:\/\//i.test(url) || url.startsWith("about:")) return url;
	if (url.startsWith("localhost") || url.startsWith("127.0.0.1")) {
		return `http://${url}`;
	}
	if (url.includes(".")) return `https://${url}`;
	return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
}

function containsControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

function legacyCookieKeychainIdentity(
	metadataPath: string,
): CookieKeychainIdentity | null {
	try {
		const metadata: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));
		if (!metadata || typeof metadata !== "object") return null;
		const record = metadata as Record<string, unknown>;
		const keychain = record.keychain;
		if (
			record.version !== 1 ||
			record.source !== "electron-guest-partition" ||
			!keychain ||
			typeof keychain !== "object"
		) {
			return null;
		}
		const identity = keychain as Record<string, unknown>;
		if (
			typeof identity.service !== "string" ||
			identity.service.length === 0 ||
			identity.service.length > 256 ||
			containsControlCharacters(identity.service) ||
			typeof identity.account !== "string" ||
			identity.account.length === 0 ||
			identity.account.length > 256 ||
			containsControlCharacters(identity.account)
		) {
			return null;
		}
		return { service: identity.service, account: identity.account };
	} catch {
		return null;
	}
}

function protocolOf(url: string): string | null {
	try {
		return new URL(url).protocol;
	} catch {
		return null;
	}
}

export function isDeepLinkUrl(url: string): boolean {
	const protocol = protocolOf(url);
	return protocol !== null && DEEP_LINK_SCHEMES.has(protocol);
}

/** Resolve address-bar input without ever silently accepting a blocked scheme. */
export function resolveGuestUrl(input: string): string {
	const trimmed = input.trim();
	const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
	if (schemeMatch) {
		const scheme = `${(schemeMatch[1] as string).toLowerCase()}:`;
		const rest = trimmed.slice((schemeMatch[0] as string).length);
		const looksLikeHostPort = /^\d+(?:[/?#]|$)/.test(rest);
		if (!looksLikeHostPort && !ALLOWED_GUEST_SCHEMES.has(scheme)) {
			throw new Error(
				`Refusing to open a ${scheme} URL in the browser pane. Only http, https, and about: URLs are allowed.`,
			);
		}
	}
	return sanitizeUrl(trimmed);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asPane(value: unknown): BrowserPaneInfo {
	if (!value || typeof value !== "object") {
		throw new Error("Native browser returned an invalid pane");
	}
	const pane = value as Partial<BrowserPaneInfo>;
	if (typeof pane.paneId !== "string")
		throw new Error("Native browser returned a pane without an id");
	return {
		paneId: pane.paneId,
		workspaceId: typeof pane.workspaceId === "string" ? pane.workspaceId : null,
		url: typeof pane.url === "string" ? pane.url : DEFAULT_BROWSER_URL,
		title: typeof pane.title === "string" ? pane.title : "",
		isLoading: pane.isLoading === true,
		canGoBack: pane.canGoBack === true,
		canGoForward: pane.canGoForward === true,
		zoomFactor:
			typeof pane.zoomFactor === "number" && Number.isFinite(pane.zoomFactor)
				? pane.zoomFactor
				: 1,
	};
}

function asEvent(value: unknown): NativeBrowserEvent | null {
	if (!value || typeof value !== "object") return null;
	const event = value as Partial<NativeBrowserEvent>;
	return typeof event.kind === "string" ? (event as NativeBrowserEvent) : null;
}

/**
 * Node-side browser coordinator. It owns no guest document and has no native
 * browser object; every guest operation crosses the single native adapter.
 */
class BrowserManager extends EventEmitter {
	private readonly panes = new Map<string, PaneRegistration>();
	private readonly registrationTasks = new Map<string, PaneRegistrationTask>();
	private readonly consoleLogs = new Map<string, ConsoleEntry[]>();
	private readonly guestListeners = new Map<string, Set<GuestListener>>();
	private readonly cdpSessions = new Map<string, CdpRegistration>();
	private readonly agentWakes = new Set<string>();
	private readonly forwardableChordsByOwner = new Map<string, Set<string>>();
	private readonly contextActions = new Map<
		string,
		{ paneId: string; action: string; url?: string; text?: string }
	>();
	private contextActionSequence = 0;
	private legacyCookieImport: Promise<LegacyCookieImportResult> | null = null;
	private readonly designMode = new DesignModeController();
	private cdpSequence = 0;

	constructor() {
		super();
		subscribeNativeBrowserEvents((event) => this.handleNativeEvent(event));
		subscribeNativeMenuEvents((payload, ownerLabel) =>
			this.handleContextAction(payload, ownerLabel),
		);
	}

	async setForwardableChords(
		chords: string[],
		ownerLabel: string,
	): Promise<void> {
		this.forwardableChordsByOwner.set(ownerLabel, new Set(chords));
		await dispatchNativeBrowser(
			"browser.hotkeys.setForwardableChords",
			{ chords },
			ownerLabel,
		);
	}

	/** Called by the native host's browser:event event demultiplexer. */
	handleNativeEvent(raw: unknown): void {
		const event = asEvent(raw);
		if (!event) return;
		const ownerLabel =
			typeof event.ownerLabel === "string" ? event.ownerLabel : null;
		if (!ownerLabel) return;
		const paneId = typeof event.paneId === "string" ? event.paneId : null;
		if (paneId) {
			const registeredPane = this.panes.get(paneId);
			if (registeredPane && registeredPane.ownerLabel !== ownerLabel) return;
			if (!registeredPane && event.kind !== "paneRegistered") return;
		}
		switch (event.kind) {
			case "paneRegistered":
			case "paneState": {
				if (!paneId) return;
				const previous = this.panes.get(paneId);
				const pane = this.mergePane(previous, event);
				this.panes.set(paneId, pane);
				if (event.kind === "paneRegistered") {
					this.emit("pane-registered", {
						paneId,
						workspaceId: pane.workspaceId,
					});
				}
				this.emit(`pane-state:${paneId}`, { ...pane, kind: event.kind });
				this.notifyGuest(paneId, "paneState", event);
				return;
			}
			case "paneClosed":
				if (paneId) this.handlePaneClosed(paneId, "pane closed");
				return;
			case "deepLink":
				if (typeof event.url === "string") this.emit("deep-link", event.url);
				return;
			case "navigationStarted":
			case "navigationCommitted":
			case "navigationFailed":
			case "loadingStarted":
			case "loadingFinished":
			case "addressChanged":
				if (paneId) {
					this.applyNavigationEvent(paneId, event);
					this.notifyGuest(paneId, "navigation", event);
				}
				return;
			case "console":
				if (paneId) this.recordConsole(paneId, event);
				return;
			case "foundInPage":
				if (paneId)
					this.emit(`found-in-page:${paneId}`, {
						activeMatchOrdinal:
							typeof event.activeMatchOrdinal === "number"
								? event.activeMatchOrdinal
								: 0,
						matches: typeof event.matches === "number" ? event.matches : 0,
					});
				return;
			case "newWindow":
				if (paneId && typeof event.url === "string") {
					if (event.popup === true) this.emit(`popup:${paneId}`, event);
					else this.emit(`new-window:${paneId}`, event.url);
				}
				return;
			case "contextMenuAction":
				if (paneId) this.emit(`context-menu-action:${paneId}`, event);
				return;
			case "closePane":
				if (paneId) this.emit(`close-pane:${paneId}`);
				return;
			case "reloadPane":
				if (paneId) this.emit(`reload-pane:${paneId}`);
				return;
			case "paneFocus":
				if (paneId) this.emit(`pane-focus:${paneId}`);
				return;
			case "keyForward":
				if (paneId && isForwardedKey(event.key))
					this.emit(`key-forward:${paneId}`, event.key);
				return;
			case "agentActive":
				this.agentWakes.clear();
				for (const id of Array.isArray(event.paneIds) ? event.paneIds : []) {
					if (typeof id === "string") this.agentWakes.add(id);
				}
				this.emit("agent-active", { paneIds: [...this.agentWakes] });
				return;
			case "cdp":
				if (paneId && typeof event.sessionId === "string") {
					const session = this.cdpSessions.get(event.sessionId);
					if (session && typeof event.payload === "string") {
						try {
							const payload = JSON.parse(event.payload) as Record<
								string,
								unknown
							>;
							if (typeof payload.method === "string") {
								const sessionId = tagEventSession(
									typeof payload.sessionId === "string"
										? payload.sessionId
										: undefined,
									session.flatSessionId,
								);
								if (sessionId) payload.sessionId = sessionId;
							}
							session.onMessage(JSON.stringify(payload));
						} catch {
							session.onMessage(event.payload);
						}
					}
				}
				return;
			case "cdpClosed":
				if (paneId) {
					for (const [sessionId, session] of this.cdpSessions) {
						if (sessionId.startsWith(`${paneId}:`)) {
							session.closed = true;
							this.cdpSessions.delete(sessionId);
							session.onDetach(
								String(event.reason ?? "native event backpressure"),
							);
						}
					}
				}
				return;
			case "download":
				this.emit("download", event);
				return;
			default:
				return;
		}
	}

	private mergePane(
		previous: PaneRegistration | undefined,
		event: NativeBrowserEvent,
	): PaneRegistration {
		return {
			paneId: previous?.paneId ?? String(event.paneId),
			workspaceId:
				typeof event.workspaceId === "string"
					? event.workspaceId
					: (previous?.workspaceId ?? null),
			url: typeof event.url === "string" ? event.url : (previous?.url ?? ""),
			title:
				typeof event.title === "string" ? event.title : (previous?.title ?? ""),
			isLoading:
				typeof event.isLoading === "boolean"
					? event.isLoading
					: (previous?.isLoading ?? false),
			canGoBack:
				typeof event.canGoBack === "boolean"
					? event.canGoBack
					: (previous?.canGoBack ?? false),
			canGoForward:
				typeof event.canGoForward === "boolean"
					? event.canGoForward
					: (previous?.canGoForward ?? false),
			zoomFactor:
				typeof event.zoomFactor === "number"
					? event.zoomFactor
					: (previous?.zoomFactor ?? 1),
			ownerLabel:
				typeof event.ownerLabel === "string"
					? event.ownerLabel
					: (previous?.ownerLabel ?? "main"),
		};
	}

	private applyNavigationEvent(
		paneId: string,
		event: NativeBrowserEvent,
	): void {
		const previous = this.panes.get(paneId);
		if (!previous) return;
		this.panes.set(paneId, this.mergePane(previous, event));
		this.emit(`pane-state:${paneId}`, {
			...this.panes.get(paneId),
			kind: event.kind,
		});
	}

	private showContextMenu(
		paneId: string,
		request: Record<string, unknown>,
	): void {
		const pane = this.panes.get(paneId);
		if (!pane) return;
		const linkURL = typeof request.linkURL === "string" ? request.linkURL : "";
		const pageURL = typeof request.pageURL === "string" ? request.pageURL : "";
		const selectionText =
			typeof request.selectionText === "string"
				? request.selectionText.slice(0, 4096)
				: "";
		for (const [id, action] of this.contextActions) {
			if (action.paneId === paneId) this.contextActions.delete(id);
		}
		const items: Array<Record<string, unknown>> = [];
		const add = (
			label: string,
			action: string,
			value?: { url?: string; text?: string },
		) => {
			const id = `browser-context-${++this.contextActionSequence}`;
			this.contextActions.set(id, { paneId, action, ...value });
			items.push({ label, action: id });
		};
		if (linkURL) {
			add("Open Link as New Split", "open-in-split", { url: linkURL });
			add("Open Link in Default Browser", "open-external", { url: linkURL });
			add("Copy Link Address", "copy", { text: linkURL });
		}
		if (selectionText) add("Copy Selection", "copy", { text: selectionText });
		if (pageURL && pageURL !== "about:blank") {
			add("Open Page in Default Browser", "open-external", { url: pageURL });
			add("Copy Page URL", "copy", { text: pageURL });
			if (pane.canGoBack) add("Back", "back");
			if (pane.canGoForward) add("Forward", "forward");
			add("Reload", "reload");
		}
		if (!items.length) return;
		while (this.contextActions.size > 256) {
			const oldest = this.contextActions.keys().next().value;
			if (!oldest) break;
			this.contextActions.delete(oldest);
		}
		void dispatchNativeBrowser(
			"menu.popupContext",
			{ items },
			pane.ownerLabel,
		).catch((error) => console.error("[browser] context menu failed", error));
	}

	private handleContextAction(raw: unknown, ownerLabel?: string): void {
		if (!raw || typeof raw !== "object") return;
		const actionId = (raw as { action?: unknown }).action;
		if (typeof actionId !== "string") return;
		const action = this.contextActions.get(actionId);
		if (
			!action ||
			(this.panes.get(action.paneId)?.ownerLabel ?? "main") !== ownerLabel
		)
			return;
		this.contextActions.delete(actionId);
		if (action.action === "open-in-split" && action.url) {
			this.emit(`context-menu-action:${action.paneId}`, {
				action: "open-in-split",
				url: action.url,
			});
		} else if (action.action === "open-external" && action.url) {
			void dispatchNativeBrowser(
				"shell.openExternal",
				{ url: action.url },
				ownerLabel,
			);
		} else if (action.action === "copy" && action.text) {
			void dispatchNativeBrowser(
				"clipboard.writeText",
				{ text: action.text },
				ownerLabel,
			);
		} else if (action.action === "back") {
			void this.goBack(action.paneId);
		} else if (action.action === "forward") {
			void this.goForward(action.paneId);
		} else if (action.action === "reload") {
			void this.reload(action.paneId);
		}
	}

	private recordConsole(paneId: string, event: NativeBrowserEvent): void {
		if (event.message === "__SUPERSET_FOCUS__") {
			this.emit(`pane-focus:${paneId}`);
			return;
		}
		if (
			typeof event.message === "string" &&
			event.message.startsWith("__SUPERSET_INPUT__")
		) {
			try {
				const key = JSON.parse(
					event.message.slice("__SUPERSET_INPUT__".length),
				) as ForwardedKey;
				const chord = chordFromInput(key);
				const ownerLabel = this.panes.get(paneId)?.ownerLabel;
				if (
					chord &&
					ownerLabel &&
					this.forwardableChordsByOwner.get(ownerLabel)?.has(chord)
				)
					this.emit(`key-forward:${paneId}`, key);
			} catch {
				// Ignore malformed guest bridge observations.
			}
			return;
		}
		if (
			typeof event.message === "string" &&
			event.message.startsWith("__SUPERSET_CONTEXT__")
		) {
			try {
				this.showContextMenu(
					paneId,
					JSON.parse(
						event.message.slice("__SUPERSET_CONTEXT__".length),
					) as Record<string, unknown>,
				);
			} catch {
				// Ignore malformed guest bridge observations.
			}
			return;
		}
		const level = isConsoleLevel(event.level) ? event.level : "log";
		const entries = this.consoleLogs.get(paneId) ?? [];
		const entry: ConsoleEntry = {
			level,
			message: typeof event.message === "string" ? event.message : "",
			timestamp:
				typeof event.timestamp === "number" ? event.timestamp : Date.now(),
		};
		entries.push(entry);
		if (entries.length > MAX_CONSOLE_ENTRIES)
			entries.splice(0, entries.length - MAX_CONSOLE_ENTRIES);
		this.consoleLogs.set(paneId, entries);
		this.emit(`console:${paneId}`, entry);
	}

	private notifyGuest(paneId: string, event: string, payload: unknown): void {
		for (const listener of this.guestListeners.get(paneId) ?? []) {
			if (listener.event === event) listener.listener(payload);
		}
	}

	private handlePaneClosed(paneId: string, reason: string): void {
		this.panes.delete(paneId);
		this.consoleLogs.delete(paneId);
		this.designMode.cancel(paneId, "destroyed");
		for (const [sessionId, session] of this.cdpSessions) {
			if (sessionId.startsWith(`${paneId}:`)) {
				session.closed = true;
				this.cdpSessions.delete(sessionId);
				session.onDetach(reason);
			}
		}
		this.agentWakes.delete(paneId);
		this.emit("agent-active", { paneIds: [...this.agentWakes] });
	}

	private call<T>(
		method: string,
		params: unknown,
		ownerLabel: string,
	): Promise<T> {
		return dispatchNativeBrowser<T>(method, params, ownerLabel);
	}

	private callForPane<T>(
		method: string,
		paneId: string,
		params: unknown,
		trustedOwnerLabel?: string,
		workspaceId?: string,
	): Promise<T> {
		const pane = this.panes.get(paneId);
		if (!pane || (workspaceId != null && pane.workspaceId !== workspaceId)) {
			throw new Error(`No browser pane ${paneId}`);
		}
		if (trustedOwnerLabel && pane.ownerLabel !== trustedOwnerLabel) {
			throw new Error(`Browser pane ${paneId} is not owned by this renderer`);
		}
		// Calls without a renderer label originate only from the authenticated
		// Node automation bridge or native lifecycle handling, never guest input.
		return this.call(method, params, trustedOwnerLabel ?? pane.ownerLabel);
	}

	async register(
		paneId: string,
		options: BrowserRegisterOptions = {},
		ownerLabel: string,
	): Promise<{ success: true; pane: BrowserPaneInfo }> {
		if (!ownerLabel) {
			throw new Error("Browser registration requires a trusted window label");
		}
		const requestedUrl = resolveGuestUrl(options.url ?? DEFAULT_BROWSER_URL);
		const workspaceId = options.workspaceId ?? null;
		const pending = this.registrationTasks.get(paneId);
		if (pending && pending.ownerLabel !== ownerLabel) {
			throw new Error(`Browser pane ${paneId} is not owned by this renderer`);
		}
		if (pending && pending.workspaceId !== workspaceId) {
			throw new Error(
				`Browser pane ${paneId} is already registered for another workspace`,
			);
		}
		const promise = pending
			? pending.promise.then(() =>
					this.registerNativePane(
						paneId,
						options,
						workspaceId,
						requestedUrl,
						ownerLabel,
					),
				)
			: this.registerNativePane(
					paneId,
					options,
					workspaceId,
					requestedUrl,
					ownerLabel,
				);
		const task: PaneRegistrationTask = { ownerLabel, workspaceId, promise };
		this.registrationTasks.set(paneId, task);
		try {
			return await promise;
		} finally {
			if (this.registrationTasks.get(paneId) === task) {
				this.registrationTasks.delete(paneId);
			}
		}
	}

	private async registerNativePane(
		paneId: string,
		options: BrowserRegisterOptions,
		workspaceId: string | null,
		requestedUrl: string,
		ownerLabel: string,
	): Promise<{ success: true; pane: BrowserPaneInfo }> {
		const existing = this.panes.get(paneId);
		if (existing) {
			if (existing.ownerLabel !== ownerLabel) {
				throw new Error(`Browser pane ${paneId} is not owned by this renderer`);
			}
			if (existing.workspaceId !== workspaceId) {
				throw new Error(
					`Browser pane ${paneId} is already registered for another workspace`,
				);
			}
			let nativePane: BrowserPaneInfo | null = null;
			try {
				nativePane = asPane(
					await this.call("browser.pane.info", { paneId }, ownerLabel),
				);
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!error.message.includes(`no browser pane ${paneId}`)
				) {
					throw error;
				}
				this.handlePaneClosed(paneId, "pane closed");
			}
			if (nativePane) {
				if (nativePane.paneId !== paneId) {
					throw new Error("Native browser returned a different pane id");
				}
				if (nativePane.workspaceId !== workspaceId) {
					throw new Error(
						`Native browser pane ${paneId} belongs to another workspace`,
					);
				}
				this.panes.set(paneId, { ...nativePane, ownerLabel });
				if (options.bounds)
					await this.setBounds(paneId, options.bounds, ownerLabel);
				await this.setVisibility(paneId, options.visible ?? true, ownerLabel);
				this.emit("pane-registered", {
					paneId,
					workspaceId: nativePane.workspaceId,
				});
				return { success: true, pane: { ...nativePane } };
			}
		}
		const pane = asPane(
			await this.call(
				"browser.pane.create",
				{
					paneId,
					workspaceId,
					url: "about:blank",
					visible: options.visible ?? true,
					bounds: options.bounds,
				},
				ownerLabel,
			),
		);
		this.panes.set(paneId, {
			...pane,
			ownerLabel,
		});
		this.emit("pane-registered", {
			paneId,
			workspaceId: pane.workspaceId,
		});
		try {
			const migration = await this.importLegacyCookies(ownerLabel, paneId);
			if (
				migration.snapshotAvailable &&
				(migration.keyUnavailable || migration.skipped > 0)
			) {
				throw new Error(
					"Legacy browser cookies could not be fully imported; initial navigation was paused",
				);
			}
		} catch (error) {
			try {
				await this.callForPane(
					"browser.pane.destroy",
					paneId,
					{ paneId },
					ownerLabel,
				);
			} catch (cleanupError) {
				console.warn(
					"[browser] failed to close pane after cookie import error",
					cleanupError,
				);
			} finally {
				this.handlePaneClosed(paneId, "cookie import failed");
			}
			throw error;
		}
		if (requestedUrl !== "about:blank") {
			await this.callForPane(
				"browser.pane.navigate",
				paneId,
				{ paneId, url: requestedUrl },
				ownerLabel,
			);
			pane.url = requestedUrl;
			const current = this.panes.get(paneId);
			if (current) this.panes.set(paneId, { ...current, url: requestedUrl });
		}
		return { success: true, pane: { ...pane, url: requestedUrl } };
	}

	async unregister(
		paneId: string,
		ownerLabel?: string,
	): Promise<{ success: true }> {
		await this.callForPane(
			"browser.pane.destroy",
			paneId,
			{ paneId },
			ownerLabel,
		);
		this.handlePaneClosed(paneId, "pane closed");
		return { success: true };
	}

	getPane(paneId: string, workspaceId?: string): BrowserPaneInfo | null {
		const pane = this.panes.get(paneId);
		if (!pane || (workspaceId != null && pane.workspaceId !== workspaceId))
			return null;
		return { ...pane };
	}

	assertPaneOwner(paneId: string, ownerLabel: string): void {
		const pane = this.panes.get(paneId);
		if (!pane || pane.ownerLabel !== ownerLabel) {
			throw new Error(`Browser pane ${paneId} is not owned by this renderer`);
		}
	}

	async getPageInfo(
		paneId: string,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<BrowserPaneInfo | null> {
		const previous = this.panes.get(paneId);
		if (previous && workspaceId != null && previous.workspaceId !== workspaceId)
			return null;
		const trustedOwnerLabel = ownerLabel ?? previous?.ownerLabel;
		if (!trustedOwnerLabel) return null;
		let pane: BrowserPaneInfo;
		try {
			pane = asPane(
				await this.call("browser.pane.info", { paneId }, trustedOwnerLabel),
			);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes(`no browser pane ${paneId}`)
			)
				return null;
			throw error;
		}
		if (workspaceId != null && pane.workspaceId !== workspaceId) return null;
		this.panes.set(paneId, {
			...pane,
			ownerLabel: previous?.ownerLabel ?? trustedOwnerLabel,
		});
		return pane;
	}

	listPanes(workspaceId?: string): BrowserPaneInfo[] {
		return [...this.panes.values()]
			.filter((pane) => workspaceId == null || pane.workspaceId === workspaceId)
			.map(({ ownerLabel: _ownerLabel, ...pane }) => pane);
	}

	async listPanesLive(workspaceId?: string): Promise<BrowserPaneInfo[]> {
		if (this.panes.size === 0) return [];
		const ownerLabels = new Set(
			[...this.panes.values()]
				.filter(
					(pane) => workspaceId == null || pane.workspaceId === workspaceId,
				)
				.map((pane) => pane.ownerLabel),
		);
		const pages = await Promise.all(
			[...ownerLabels].map((ownerLabel) =>
				this.call<unknown>("browser.panes.list", { workspaceId }, ownerLabel),
			),
		);
		if (pages.some((value) => !Array.isArray(value)))
			throw new Error("Native browser returned an invalid pane list");
		const panes = pages.flatMap((value) => (value as unknown[]).map(asPane));
		for (const pane of panes) {
			const previous = this.panes.get(pane.paneId);
			this.panes.set(pane.paneId, {
				...pane,
				ownerLabel: previous?.ownerLabel ?? "main",
			});
		}
		return panes;
	}

	requestOpen(request: BrowserOpenRequest): void {
		this.emit("open-request", request);
	}

	async navigate(
		paneId: string,
		url: string,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<{ success: true }> {
		this.requirePane(paneId, workspaceId);
		await this.callForPane(
			"browser.pane.navigate",
			paneId,
			{ paneId, url: resolveGuestUrl(url) },
			ownerLabel,
			workspaceId,
		);
		return { success: true };
	}

	async goBack(
		paneId: string,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId, workspaceId);
		await this.callForPane(
			"browser.pane.goBack",
			paneId,
			{ paneId },
			ownerLabel,
			workspaceId,
		);
	}

	async goForward(
		paneId: string,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId, workspaceId);
		await this.callForPane(
			"browser.pane.goForward",
			paneId,
			{ paneId },
			ownerLabel,
			workspaceId,
		);
	}

	async reload(
		paneId: string,
		hard = false,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<boolean> {
		if (!this.getPane(paneId, workspaceId)) return false;
		await this.callForPane(
			"browser.pane.reload",
			paneId,
			{ paneId, hard },
			ownerLabel,
			workspaceId,
		);
		return true;
	}

	async screenshot(
		paneId: string,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<BrowserScreenshot> {
		this.requirePane(paneId, workspaceId);
		return this.callForPane<BrowserScreenshot>(
			"browser.pane.screenshot",
			paneId,
			{ paneId },
			ownerLabel,
			workspaceId,
		);
	}

	async capturePng(paneId: string, workspaceId?: string): Promise<string> {
		return (await this.screenshot(paneId, workspaceId)).base64;
	}

	async evaluateJS(
		paneId: string,
		code: string,
		workspaceId?: string,
		ownerLabel?: string,
	): Promise<unknown> {
		this.requirePane(paneId, workspaceId);
		return this.callForPane(
			"browser.pane.evaluate",
			paneId,
			{ paneId, code },
			ownerLabel,
			workspaceId,
		);
	}

	getConsoleLogs(paneId: string, workspaceId?: string): ConsoleEntry[] {
		if (!this.getPane(paneId, workspaceId)) return [];
		return [...(this.consoleLogs.get(paneId) ?? [])];
	}

	async setDesignMode(
		paneId: string,
		enabled: boolean,
		ownerLabel?: string,
	): Promise<boolean> {
		if (!this.getPane(paneId)) return false;
		await this.callForPane(
			"browser.pane.designMode",
			paneId,
			{
				paneId,
				action: enabled ? "arm" : "teardown",
			},
			ownerLabel,
		);
		return true;
	}

	awaitDesignSelection(
		paneId: string,
		opId: string,
	): Promise<DesignModeSelectionResult> {
		if (!this.getPane(paneId)) {
			return Promise.resolve({
				opId,
				kind: "error",
				reason: `No browser pane ${paneId}`,
			});
		}
		return this.designMode.awaitSelection(paneId, opId, this.guestFor(paneId));
	}

	cancelDesignSelection(paneId: string, ownerLabel?: string): void {
		this.designMode.cancel(paneId, "user");
		void this.callForPane(
			"browser.pane.designMode",
			paneId,
			{
				paneId,
				action: "teardown",
			},
			ownerLabel,
		).catch(() => {});
	}

	async captureDesignScreenshot(
		paneId: string,
		rect: DesignModeRect,
		ownerLabel?: string,
	): Promise<DesignModeScreenshot | null> {
		if (!this.getPane(paneId)) return null;
		return this.callForPane<DesignModeScreenshot | null>(
			"browser.pane.designScreenshot",
			paneId,
			{ paneId, rect },
			ownerLabel,
		);
	}

	getAgentActivePaneIds(ownerLabel: string): string[] {
		return [...this.agentWakes].filter(
			(paneId) => this.panes.get(paneId)?.ownerLabel === ownerLabel,
		);
	}

	attachCdp(
		paneId: string,
		workspaceId: string,
		onMessage: (payload: string) => void,
		onDetach: (reason: string) => void,
	): CdpSession {
		this.requirePane(paneId, workspaceId);
		if (
			[...this.cdpSessions.values()].some((s) =>
				s.sessionId.startsWith(`${paneId}:`),
			)
		) {
			throw new CdpBusyError(
				`A CDP session is already attached to pane ${paneId}`,
			);
		}
		const sessionId = `${paneId}:${++this.cdpSequence}`;
		const registration: CdpRegistration = {
			sessionId,
			ids: shimIds(paneId),
			flatSessionId: null,
			autoAttachEmitted: false,
			onMessage,
			onDetach,
			closed: false,
		};
		this.cdpSessions.set(sessionId, registration);
		this.agentWakes.add(paneId);
		this.emit("agent-active", { paneIds: [...this.agentWakes] });
		void this.callForPane(
			"browser.cdp.attach",
			paneId,
			{ paneId, sessionId },
			undefined,
			workspaceId,
		).catch((error) => {
			if (!registration.closed) {
				registration.closed = true;
				this.cdpSessions.delete(sessionId);
				this.agentWakes.delete(paneId);
				this.emit("agent-active", { paneIds: [...this.agentWakes] });
				onDetach(errorMessage(error));
			}
		});

		const detach = () => {
			if (registration.closed) return;
			registration.closed = true;
			this.cdpSessions.delete(sessionId);
			this.agentWakes.delete(paneId);
			this.emit("agent-active", { paneIds: [...this.agentWakes] });
			void this.callForPane(
				"browser.cdp.detach",
				paneId,
				{ paneId, sessionId },
				undefined,
				workspaceId,
			).catch(() => {});
		};
		return {
			send: (rawMessage) => {
				if (registration.closed) return;
				let input: Record<string, unknown>;
				try {
					input = JSON.parse(rawMessage) as Record<string, unknown>;
				} catch {
					onMessage(
						JSON.stringify({
							error: { code: -32700, message: "Invalid JSON" },
						}),
					);
					return;
				}
				const method = typeof input.method === "string" ? input.method : "";
				const clientSessionId =
					typeof input.sessionId === "string" ? input.sessionId : undefined;
				const target = handleTargetCommand(method, input.params, {
					ids: registration.ids,
					url: this.getPane(paneId)?.url ?? "",
					title: this.getPane(paneId)?.title ?? "",
					flatSessionId: registration.flatSessionId,
					autoAttachEmitted: registration.autoAttachEmitted,
				});
				if (target) {
					registration.flatSessionId = target.flatSessionId;
					registration.autoAttachEmitted = target.autoAttachEmitted;
					for (const event of target.events) onMessage(JSON.stringify(event));
					if (target.navigateTo)
						void this.navigate(paneId, target.navigateTo, workspaceId).catch(
							() => {},
						);
					const response: Record<string, unknown> = {
						id: input.id,
						result: target.result,
					};
					if (clientSessionId) response.sessionId = clientSessionId;
					onMessage(JSON.stringify(response));
					return;
				}
				const forwardedSessionId = forwardSessionFor(
					clientSessionId,
					registration.flatSessionId,
				);
				if (forwardedSessionId) input.sessionId = forwardedSessionId;
				else delete input.sessionId;
				void this.callForPane<{ payload?: string } | string>(
					"browser.cdp.send",
					paneId,
					{
						paneId,
						sessionId,
						message: JSON.stringify(input),
					},
					undefined,
					workspaceId,
				)
					.then((response) => {
						if (registration.closed) return;
						const payload =
							typeof response === "string" ? response : response?.payload;
						if (payload) {
							try {
								const parsed = JSON.parse(payload) as Record<string, unknown>;
								if (clientSessionId) parsed.sessionId = clientSessionId;
								onMessage(JSON.stringify(parsed));
							} catch {
								onMessage(payload);
							}
						}
					})
					.catch((error) => {
						if (!registration.closed) onDetach(errorMessage(error));
					});
			},
			detach,
		};
	}

	async openDevTools(paneId: string, ownerLabel?: string): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.openDevTools",
			paneId,
			{ paneId },
			ownerLabel,
		);
	}

	async setDeviceEmulation(
		paneId: string,
		params: { width: number; height: number } | null,
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.setDeviceEmulation",
			paneId,
			{ paneId, params },
			ownerLabel,
		);
	}

	async findInPage(
		paneId: string,
		text: string,
		options: { forward?: boolean; findNext?: boolean } = {},
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.findInPage",
			paneId,
			{
				paneId,
				text,
				forward: options.forward ?? true,
				findNext: options.findNext ?? true,
			},
			ownerLabel,
		);
	}

	async stopFindInPage(
		paneId: string,
		action: "clearSelection" | "keepSelection" | "activateSelection",
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.stopFindInPage",
			paneId,
			{ paneId, action },
			ownerLabel,
		);
	}

	async print(paneId: string, ownerLabel?: string): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.print",
			paneId,
			{ paneId },
			ownerLabel,
		);
	}

	async setZoom(
		paneId: string,
		zoomFactor: number,
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.setZoom",
			paneId,
			{ paneId, zoomFactor },
			ownerLabel,
		);
	}

	async setBounds(
		paneId: string,
		bounds: BrowserBounds,
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.setBounds",
			paneId,
			{ paneId, bounds },
			ownerLabel,
		);
	}

	async setVisibility(
		paneId: string,
		visible: boolean,
		ownerLabel?: string,
	): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.setVisibility",
			paneId,
			{ paneId, visible },
			ownerLabel,
		);
	}

	async focus(paneId: string, ownerLabel?: string): Promise<void> {
		this.requirePane(paneId);
		await this.callForPane(
			"browser.pane.focus",
			paneId,
			{ paneId },
			ownerLabel,
		);
	}

	async clearBrowsingData(
		type: "cookies" | "cache" | "storage" | "all",
		ownerLabel: string,
	): Promise<void> {
		await this.call("browser.storage.clear", { type }, ownerLabel);
	}

	async getCookieDomains(
		ownerLabel: string,
	): Promise<Array<{ domain: string; cookieCount: number }>> {
		return this.call("browser.cookies.domains", {}, ownerLabel);
	}

	async clearCookiesForDomain(
		domain: string,
		ownerLabel: string,
	): Promise<void> {
		await this.call("browser.cookies.clearDomain", { domain }, ownerLabel);
	}

	async importCookiesFromSource(
		sourceId: string,
		ownerLabel: string,
		preferredPaneId?: string,
	): Promise<ImportedCookieWriteResult> {
		const profile = resolveImportProfile(sourceId);
		if (!profile)
			throw new Error("That browser profile is no longer available.");
		const read = await readCookiesFromProfileWithStatus(
			profile.profileDir,
			profile.browserKey,
		);
		if (read.keyUnavailable) {
			return { imported: 0, skipped: read.skipped, keyUnavailable: true };
		}
		const result = read.cookies.length
			? await this.setImportedCookies(read.cookies, ownerLabel, preferredPaneId)
			: { imported: 0, skipped: 0 };
		return {
			imported: result.imported,
			skipped: result.skipped + read.skipped,
			keyUnavailable: false,
		};
	}

	async importLegacyCookies(
		ownerLabel: string,
		preferredPaneId?: string,
	): Promise<LegacyCookieImportResult> {
		if (this.legacyCookieImport) return this.legacyCookieImport;
		const operation = this.importLegacyCookiesForOwner(
			ownerLabel,
			preferredPaneId,
		).finally(() => {
			this.legacyCookieImport = null;
		});
		this.legacyCookieImport = operation;
		return operation;
	}

	private async importLegacyCookiesForOwner(
		ownerLabel: string,
		preferredPaneId?: string,
	): Promise<LegacyCookieImportResult> {
		let userDataPath: string;
		try {
			userDataPath = getNativePath("userData");
		} catch {
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: false,
				snapshotAvailable: false,
			};
		}
		const markerPath = join(userDataPath, ...LEGACY_COOKIE_IMPORT_MARKER);
		if (existsSync(markerPath)) {
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: false,
				snapshotAvailable: true,
			};
		}
		if (
			![...this.panes.values()].some((pane) => pane.ownerLabel === ownerLabel)
		) {
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: false,
				snapshotAvailable: false,
			};
		}
		const profile = join(userDataPath, ...LEGACY_GUEST_SNAPSHOT);
		const cookiesPath = join(profile, "Cookies");
		const metadataPath = join(profile, LEGACY_GUEST_METADATA);
		if (!existsSync(cookiesPath)) {
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: false,
				snapshotAvailable: false,
			};
		}
		if (
			lstatSync(cookiesPath).isSymbolicLink() ||
			!lstatSync(cookiesPath).isFile() ||
			!existsSync(metadataPath) ||
			lstatSync(metadataPath).isSymbolicLink() ||
			!lstatSync(metadataPath).isFile()
		) {
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: true,
				snapshotAvailable: true,
			};
		}
		const identity = legacyCookieKeychainIdentity(metadataPath);
		if (!identity) {
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: true,
				snapshotAvailable: true,
			};
		}
		const read = await readCookiesFromProfileWithStatus(
			profile,
			"electron",
			identity,
		);
		if (read.keyUnavailable) {
			return {
				imported: 0,
				skipped: read.skipped,
				keyUnavailable: true,
				snapshotAvailable: true,
			};
		}
		const result = read.cookies.length
			? await this.setImportedCookies(read.cookies, ownerLabel, preferredPaneId)
			: { imported: 0, skipped: 0 };
		const skipped = result.skipped + read.skipped;
		if (skipped > 0 || result.imported !== read.cookies.length) {
			return {
				imported: result.imported,
				skipped,
				keyUnavailable: false,
				snapshotAvailable: true,
			};
		}
		const markerDirectory = join(userDataPath, "migration");
		const temporaryMarkerPath = `${markerPath}.${randomUUID()}.tmp`;
		mkdirSync(markerDirectory, { recursive: true });
		writeFileSync(
			temporaryMarkerPath,
			JSON.stringify({
				version: 1,
				importedAt: Date.now(),
				count: result.imported,
				snapshot: LEGACY_GUEST_SNAPSHOT.join("/"),
			}),
			{ flag: "wx" },
		);
		renameSync(temporaryMarkerPath, markerPath);
		return {
			imported: result.imported,
			skipped,
			keyUnavailable: false,
			snapshotAvailable: true,
		};
	}

	private async setImportedCookies(
		cookies: ImportedCookie[],
		ownerLabel: string,
		preferredPaneId?: string,
	): Promise<ImportedCookieWriteResult> {
		if (cookies.length === 0) return { imported: 0, skipped: 0 };
		const pane = preferredPaneId
			? this.panes.get(preferredPaneId)
			: [...this.panes.values()].find(
					(candidate) => candidate.ownerLabel === ownerLabel,
				);
		if (!pane) return { imported: 0, skipped: cookies.length };
		if (pane.ownerLabel !== ownerLabel) {
			throw new Error(
				"Cookie import target belongs to another trusted renderer",
			);
		}
		return this.call<ImportedCookieWriteResult>(
			"browser.cookies.setMany",
			{
				paneId: pane.paneId,
				cookies,
			},
			ownerLabel,
		);
	}

	async importCookiesFromPane(
		sourceId: string,
		paneId: string,
		workspaceId: string,
	): Promise<{ imported: number; keyUnavailable: boolean }> {
		const pane = this.panes.get(paneId);
		if (!pane || pane.workspaceId !== workspaceId) {
			throw new Error("Cookie import target is not live in this workspace");
		}
		const result = await this.importCookiesFromSource(
			sourceId,
			pane.ownerLabel,
			paneId,
		);
		return {
			imported: result.imported,
			keyUnavailable: result.keyUnavailable === true,
		};
	}

	async unregisterAll(): Promise<void> {
		for (const paneId of [...this.panes.keys()]) await this.unregister(paneId);
	}

	private guestFor(paneId: string): BrowserGuest {
		return {
			executeJavaScript: (script) => this.evaluateJS(paneId, script),
			isDestroyed: () => !this.panes.has(paneId),
			on: (event, listener) => {
				let listeners = this.guestListeners.get(paneId);
				if (!listeners) {
					listeners = new Set();
					this.guestListeners.set(paneId, listeners);
				}
				listeners.add({ event, listener });
			},
			off: (event, listener) => {
				const listeners = this.guestListeners.get(paneId);
				if (!listeners) return;
				for (const entry of listeners) {
					if (entry.event === event && entry.listener === listener)
						listeners.delete(entry);
				}
			},
		};
	}

	private requirePane(paneId: string, workspaceId?: string): PaneRegistration {
		const pane = this.panes.get(paneId);
		if (!pane || (workspaceId != null && pane.workspaceId !== workspaceId)) {
			throw new Error(`No browser pane ${paneId}`);
		}
		return pane;
	}
}

function isConsoleLevel(value: unknown): value is ConsoleEntry["level"] {
	return (
		value === "log" ||
		value === "warn" ||
		value === "error" ||
		value === "info" ||
		value === "debug"
	);
}

function isForwardedKey(value: unknown): value is ForwardedKey {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as ForwardedKey).key === "string" &&
		typeof (value as ForwardedKey).code === "string"
	);
}

export const browserManager = new BrowserManager();
