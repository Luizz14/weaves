import { pointerPassthrough } from "renderer/lib/pointer-passthrough";
import { selectRuntimesToEvict } from "renderer/lib/terminal/terminal-runtime-eviction";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { BrowserLoadError } from "shared/tabs-types";
import { sanitizeUrl } from "./sanitizeUrl";

export interface BrowserRuntimeState {
	currentUrl: string;
	pageTitle: string;
	faviconUrl: string | null;
	isLoading: boolean;
	error: BrowserLoadError | null;
	canGoBack: boolean;
	canGoForward: boolean;
	zoomFactor: number;
}

export interface PersistableBrowserState {
	url: string;
	pageTitle: string;
	faviconUrl: string | null;
}

interface RegistryEntry {
	paneId: string;
	workspaceId: string;
	overlay: HTMLDivElement;
	state: BrowserRuntimeState;
	onPersist: ((state: PersistableBrowserState) => void) | null;
	onClose: (() => void) | null;
	placeholder: HTMLElement | null;
	resizeObserver: ResizeObserver | null;
	visible: boolean;
	nativeVisible: boolean;
	lastUsedAt: number;
	unsubscribeState: (() => void) | null;
	overlayObserver: MutationObserver | null;
	nativeReady: Promise<void>;
	visibilityQueue: Promise<void>;
}

const MAX_HIDDEN_NATIVE_VIEWS = 3;
const ROOT_CONTAINER_ID = "browser-runtime-root";
const EMPTY_STATE: BrowserRuntimeState = Object.freeze({
	currentUrl: "about:blank",
	pageTitle: "",
	faviconUrl: null,
	isLoading: false,
	error: null,
	canGoBack: false,
	canGoForward: false,
	zoomFactor: 1,
});

export const BROWSER_ZOOM = Object.freeze({ min: 0.25, max: 5, step: 0.1 });
export type BrowserZoomDirection = "in" | "out" | "reset";
export interface FindInPageResult {
	activeMatchOrdinal: number;
	matches: number;
}

function errorState(url: string): BrowserLoadError {
	return { code: -1, description: "The page failed to load", url };
}

function shouldShowNativeView(
	entry: RegistryEntry,
	agentActive: boolean,
	passthrough: boolean,
): boolean {
	if (passthrough || (!entry.visible && !agentActive)) return false;
	return ![...entry.overlay.querySelectorAll<HTMLElement>("*")].some(
		(element) => {
			const style = getComputedStyle(element);
			return (
				style.pointerEvents !== "none" &&
				style.visibility !== "hidden" &&
				style.display !== "none"
			);
		},
	);
}

class BrowserRuntimeRegistryImpl {
	private readonly entries = new Map<string, RegistryEntry>();
	private readonly listenersByPaneId = new Map<string, Set<() => void>>();
	private readonly foundInPageListenersByPaneId = new Map<
		string,
		Set<(result: FindInPageResult) => void>
	>();
	private useSeq = 0;
	private pendingEviction: ReturnType<typeof setTimeout> | null = null;
	private rootContainer: HTMLDivElement | null = null;
	private agentActivePaneIds = new Set<string>();
	private focusedPaneId: string | null = null;
	private appZoomFactor = 1;

	constructor() {
		pointerPassthrough.subscribe((active) => {
			for (const entry of this.entries.values()) {
				void this.setNativeVisibility(
					entry,
					shouldShowNativeView(
						entry,
						this.agentActivePaneIds.has(entry.paneId),
						active,
					),
				);
			}
		});
		electronTrpcClient.browser.onAgentActivePanes.subscribe(undefined, {
			onData: ({ paneIds }: { paneIds: string[] }) => {
				this.agentActivePaneIds = new Set(paneIds);
				for (const entry of this.entries.values()) {
					void this.setNativeVisibility(
						entry,
						shouldShowNativeView(
							entry,
							this.agentActivePaneIds.has(entry.paneId),
							pointerPassthrough.active,
						),
					);
				}
				this.scheduleHiddenEviction();
			},
		});
	}

	private ensureRootContainer(): HTMLDivElement {
		if (this.rootContainer?.isConnected) return this.rootContainer;
		const existing = document.getElementById(
			ROOT_CONTAINER_ID,
		) as HTMLDivElement | null;
		if (existing) {
			this.rootContainer = existing;
			return existing;
		}
		const root = document.createElement("div");
		root.id = ROOT_CONTAINER_ID;
		root.style.position = "fixed";
		root.style.inset = "0";
		root.style.pointerEvents = "none";
		root.style.zIndex = "100";
		document.body.appendChild(root);
		this.rootContainer = root;
		return root;
	}

	private getListeners(paneId: string): Set<() => void> {
		let listeners = this.listenersByPaneId.get(paneId);
		if (!listeners) {
			listeners = new Set();
			this.listenersByPaneId.set(paneId, listeners);
		}
		return listeners;
	}

	private notify(paneId: string): void {
		for (const listener of this.listenersByPaneId.get(paneId) ?? []) listener();
	}

	private setState(paneId: string, patch: Partial<BrowserRuntimeState>): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.state = { ...entry.state, ...patch };
		this.notify(paneId);
		if (patch.currentUrl || patch.pageTitle || patch.faviconUrl !== undefined) {
			entry.onPersist?.({
				url: entry.state.currentUrl,
				pageTitle: entry.state.pageTitle,
				faviconUrl: entry.state.faviconUrl,
			});
		}
	}

	private updateLayout(entry: RegistryEntry): void {
		const placeholder = entry.placeholder;
		if (!placeholder) return;
		const rect = placeholder.getBoundingClientRect();
		// The renderer's page zoom changes CSS layout coordinates, while a native
		// CEF child view is positioned in the window's unzoomed logical DIPs.  The
		// device scale (Retina) is already handled by Tauri's LogicalPosition and
		// must not be folded into this conversion.
		const zoom =
			Number.isFinite(this.appZoomFactor) && this.appZoomFactor > 0
				? this.appZoomFactor
				: 1;
		for (const style of [entry.overlay.style]) {
			style.top = `${rect.top}px`;
			style.left = `${rect.left}px`;
			style.width = `${rect.width}px`;
			style.height = `${rect.height}px`;
		}
		void electronTrpcClient.browser.setBounds.mutate({
			paneId: entry.paneId,
			bounds: {
				x: rect.left * zoom,
				y: rect.top * zoom,
				width: Math.max(1, rect.width * zoom),
				height: Math.max(1, rect.height * zoom),
			},
		});
	}

	private async setNativeVisibility(
		entry: RegistryEntry,
		visible: boolean,
	): Promise<void> {
		entry.visibilityQueue = entry.visibilityQueue.then(async () => {
			if (entry.nativeVisible === visible) return;
			try {
				await electronTrpcClient.browser.setVisibility.mutate({
					paneId: entry.paneId,
					visible,
				});
				entry.nativeVisible = visible;
			} catch (error) {
				console.error(
					"[browserRuntimeRegistry] native visibility failed",
					error,
				);
			}
		});
		await entry.visibilityQueue;
	}

	private createEntry(
		paneId: string,
		initialUrl: string,
		workspaceId: string,
	): RegistryEntry {
		const overlay = document.createElement("div");
		overlay.dataset.browserPaneId = paneId;
		overlay.style.position = "fixed";
		overlay.style.pointerEvents = "none";
		overlay.style.visibility = "hidden";
		overlay.style.zIndex = "1";
		const entry: RegistryEntry = {
			paneId,
			workspaceId,
			overlay,
			state: { ...EMPTY_STATE, currentUrl: sanitizeUrl(initialUrl) },
			onPersist: null,
			onClose: null,
			placeholder: null,
			resizeObserver: null,
			visible: false,
			nativeVisible: false,
			lastUsedAt: 0,
			unsubscribeState: null,
			overlayObserver: null,
			nativeReady: Promise.resolve(),
			visibilityQueue: Promise.resolve(),
		};
		return entry;
	}

	private subscribeState(entry: RegistryEntry): void {
		entry.unsubscribeState?.();
		const subscription = electronTrpcClient.browser.onPaneState.subscribe(
			{ paneId: entry.paneId },
			{
				onData: (raw: unknown) => {
					if (!raw || typeof raw !== "object") return;
					const state = raw as Record<string, unknown>;
					const url = typeof state.url === "string" ? state.url : undefined;
					const title =
						typeof state.title === "string" ? state.title : undefined;
					const patch: Partial<BrowserRuntimeState> = {
						...(url ? { currentUrl: url } : {}),
						...(title !== undefined ? { pageTitle: title } : {}),
						...(typeof state.isLoading === "boolean"
							? { isLoading: state.isLoading }
							: {}),
						...(typeof state.canGoBack === "boolean"
							? { canGoBack: state.canGoBack }
							: {}),
						...(typeof state.canGoForward === "boolean"
							? { canGoForward: state.canGoForward }
							: {}),
						...(typeof state.zoomFactor === "number"
							? { zoomFactor: state.zoomFactor }
							: {}),
					};
					if (
						state.event === "navigationFailed" ||
						state.kind === "navigationFailed"
					) {
						patch.error = errorState(url ?? entry.state.currentUrl);
					}
					if (Object.keys(patch).length) this.setState(entry.paneId, patch);
					if (
						state.kind === "loadingFinished" &&
						url &&
						url !== "about:blank"
					) {
						void electronTrpcClient.browserHistory.upsert.mutate({
							url,
							title: title ?? entry.state.pageTitle,
							faviconUrl: entry.state.faviconUrl,
						});
					}
				},
			},
		);
		entry.unsubscribeState = () => subscription.unsubscribe();
	}

	private async createNativePane(
		entry: RegistryEntry,
		visible: boolean,
	): Promise<void> {
		const rect = entry.placeholder?.getBoundingClientRect();
		const result = await electronTrpcClient.browser.register.mutate({
			paneId: entry.paneId,
			workspaceId: entry.workspaceId,
			url: entry.state.currentUrl,
			visible,
			bounds: rect
				? {
						x: rect.left,
						y: rect.top,
						width: Math.max(1, rect.width),
						height: Math.max(1, rect.height),
					}
				: { x: 0, y: 0, width: 1280, height: 720 },
		});
		const pane = result.pane;
		if (pane) {
			this.setState(entry.paneId, {
				currentUrl:
					typeof pane.url === "string" ? pane.url : entry.state.currentUrl,
				pageTitle:
					typeof pane.title === "string" ? pane.title : entry.state.pageTitle,
				isLoading: pane.isLoading === true,
				canGoBack: pane.canGoBack === true,
				canGoForward: pane.canGoForward === true,
				zoomFactor: typeof pane.zoomFactor === "number" ? pane.zoomFactor : 1,
			});
		}
		entry.nativeVisible = visible;
	}

	openBackground(
		paneId: string,
		url: string,
		workspaceId: string,
		onPersist: (state: PersistableBrowserState) => void,
	): RegistryEntry {
		const existing = this.entries.get(paneId);
		if (existing) return existing;
		const entry = this.createEntry(paneId, url, workspaceId);
		entry.onPersist = onPersist;
		entry.lastUsedAt = ++this.useSeq;
		this.entries.set(paneId, entry);
		this.ensureRootContainer().appendChild(entry.overlay);
		entry.overlayObserver = new MutationObserver(() => {
			void this.setNativeVisibility(
				entry,
				shouldShowNativeView(
					entry,
					this.agentActivePaneIds.has(entry.paneId),
					pointerPassthrough.active,
				),
			);
		});
		entry.overlayObserver.observe(entry.overlay, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["style", "class"],
		});
		this.subscribeState(entry);
		// Native CEF child views do not become document.activeElement. Preserve
		// focus-scoped hotkeys from the trusted native pane-focus event instead.
		const focusSubscription = electronTrpcClient.browser.onPaneFocus.subscribe(
			{ paneId: entry.paneId },
			{
				onData: () => {
					this.focusedPaneId = entry.paneId;
				},
			},
		);
		entry.unsubscribeState = (() => {
			const unsubscribeState = entry.unsubscribeState;
			return () => {
				unsubscribeState?.();
				focusSubscription.unsubscribe();
			};
		})();
		entry.nativeReady = this.createNativePane(entry, false).catch((error) => {
			console.error(
				"[browserRuntimeRegistry] native pane create failed",
				error,
			);
		});
		this.scheduleHiddenEviction();
		return entry;
	}

	attach(
		paneId: string,
		placeholder: HTMLElement,
		initialUrl: string,
		workspaceId: string,
		onPersist: (state: PersistableBrowserState) => void,
		onClose: () => void,
	): void {
		const entry = this.openBackground(
			paneId,
			initialUrl,
			workspaceId,
			onPersist,
		);
		entry.workspaceId = workspaceId;
		entry.placeholder = placeholder;
		entry.visible = true;
		entry.lastUsedAt = ++this.useSeq;
		entry.onPersist = onPersist;
		entry.onClose = onClose;
		entry.overlay.style.visibility = "visible";
		entry.resizeObserver?.disconnect();
		entry.resizeObserver = new ResizeObserver(() => {
			void entry.nativeReady.then(() => this.updateLayout(entry));
		});
		entry.resizeObserver.observe(placeholder);
		void entry.nativeReady.then(() => {
			this.updateLayout(entry);
			return this.setNativeVisibility(
				entry,
				shouldShowNativeView(
					entry,
					this.agentActivePaneIds.has(entry.paneId),
					pointerPassthrough.active,
				),
			);
		});
	}

	detach(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.placeholder = null;
		entry.resizeObserver?.disconnect();
		entry.resizeObserver = null;
		entry.visible = false;
		entry.overlay.style.visibility = "hidden";
		void this.setNativeVisibility(entry, false);
		entry.lastUsedAt = ++this.useSeq;
		this.scheduleHiddenEviction();
	}

	private scheduleHiddenEviction(): void {
		if (this.pendingEviction !== null) return;
		this.pendingEviction = setTimeout(() => {
			this.pendingEviction = null;
			const candidates = [...this.entries.entries()].map(([paneId, entry]) => ({
				paneId,
				runtime: { container: entry.visible ? entry : null },
				lastUsedAt: entry.lastUsedAt,
			}));
			for (const victim of selectRuntimesToEvict(
				candidates,
				MAX_HIDDEN_NATIVE_VIEWS,
				(candidate) => this.agentActivePaneIds.has(candidate.paneId),
			)) {
				this.destroy(victim.paneId);
			}
		}, 0);
	}

	destroy(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.resizeObserver?.disconnect();
		entry.unsubscribeState?.();
		entry.overlayObserver?.disconnect();
		entry.overlay.remove();
		this.entries.delete(paneId);
		if (this.focusedPaneId === paneId) this.focusedPaneId = null;
		this.listenersByPaneId.delete(paneId);
		this.foundInPageListenersByPaneId.delete(paneId);
		void electronTrpcClient.browser.unregister.mutate({ paneId });
	}

	navigate(paneId: string, url: string): void {
		void electronTrpcClient.browser.navigate
			.mutate({ paneId, url })
			.catch(console.error);
	}

	goBack(paneId: string): void {
		void electronTrpcClient.browser.goBack
			.mutate({ paneId })
			.catch(console.error);
	}

	goForward(paneId: string): void {
		void electronTrpcClient.browser.goForward
			.mutate({ paneId })
			.catch(console.error);
	}

	reload(paneId: string): void {
		void electronTrpcClient.browser.reload
			.mutate({ paneId })
			.catch(console.error);
	}

	getState(paneId: string): BrowserRuntimeState {
		return this.entries.get(paneId)?.state ?? EMPTY_STATE;
	}

	setAppZoomFactor(factor: number): void {
		if (!Number.isFinite(factor) || factor <= 0) return;
		if (Math.abs(this.appZoomFactor - factor) < 0.0001) return;
		this.appZoomFactor = factor;
		for (const entry of this.entries.values()) {
			if (entry.placeholder) this.updateLayout(entry);
		}
	}

	getOverlayContainer(paneId: string): HTMLElement | null {
		return this.entries.get(paneId)?.overlay ?? null;
	}

	onStateChange(paneId: string, listener: () => void): () => void {
		const listeners = this.getListeners(paneId);
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	findInPage(
		paneId: string,
		text: string,
		options?: { forward?: boolean; findNext?: boolean },
	): void {
		void electronTrpcClient.browser.findInPage
			.mutate({
				paneId,
				text,
				forward: options?.forward ?? true,
				findNext: options?.findNext ?? true,
			})
			.catch(console.error);
	}

	stopFindInPage(
		paneId: string,
		action: "clearSelection" | "keepSelection" | "activateSelection",
	): void {
		void electronTrpcClient.browser.stopFindInPage
			.mutate({ paneId, action })
			.catch(console.error);
	}

	onFoundInPage(
		paneId: string,
		listener: (result: FindInPageResult) => void,
	): () => void {
		let listeners = this.foundInPageListenersByPaneId.get(paneId);
		if (!listeners) {
			listeners = new Set();
			this.foundInPageListenersByPaneId.set(paneId, listeners);
		}
		listeners.add(listener);
		const subscription = electronTrpcClient.browser.onFoundInPage.subscribe(
			{ paneId },
			{ onData: listener },
		);
		return () => {
			listeners?.delete(listener);
			subscription.unsubscribe();
		};
	}

	print(paneId: string): void {
		void electronTrpcClient.browser.print
			.mutate({ paneId })
			.catch(console.error);
	}

	setZoomFactor(paneId: string, factor: number): void {
		const clamped = Math.min(
			BROWSER_ZOOM.max,
			Math.max(BROWSER_ZOOM.min, factor),
		);
		this.setState(paneId, { zoomFactor: clamped });
		void electronTrpcClient.browser.setZoom
			.mutate({ paneId, zoomFactor: clamped })
			.catch(console.error);
	}

	stepZoom(paneId: string, direction: BrowserZoomDirection): void {
		const current = this.getState(paneId).zoomFactor;
		if (direction === "reset") {
			this.setZoomFactor(paneId, 1);
			return;
		}
		const delta = direction === "in" ? BROWSER_ZOOM.step : -BROWSER_ZOOM.step;
		this.setZoomFactor(paneId, Math.round((current + delta) * 100) / 100);
	}

	getPaneIdForWebview(element: Element): string | null {
		return (
			(element as HTMLElement).dataset.browserPaneId ??
			(element === document.body || element === document.documentElement
				? this.focusedPaneId
				: null)
		);
	}
}

export const browserRuntimeRegistry =
	(import.meta.hot?.data?.browserRegistry as
		| BrowserRuntimeRegistryImpl
		| undefined) ?? new BrowserRuntimeRegistryImpl();

if (import.meta.hot)
	import.meta.hot.data.browserRegistry = browserRuntimeRegistry;
