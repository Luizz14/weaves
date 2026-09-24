import { useCallback, useEffect, useRef } from "react";
import { useZoomFactor } from "renderer/hooks/useZoomFactor";
import { pointerPassthrough } from "renderer/lib/pointer-passthrough";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { requestPaneClose } from "renderer/stores/editor-state/editorCoordinator";
import { useTabsStore } from "renderer/stores/tabs/store";

interface UseNativeBrowserOptions {
	paneId: string;
	initialUrl: string;
	visible: boolean;
}

function rectFor(element: HTMLElement) {
	const rect = element.getBoundingClientRect();
	return {
		x: rect.left,
		y: rect.top,
		width: Math.max(1, rect.width),
		height: Math.max(1, rect.height),
	};
}

/** Owns the lifecycle of a native CEF child view; the DOM only supplies bounds. */
export function usePersistentWebview({
	paneId,
	initialUrl,
	visible,
}: UseNativeBrowserOptions) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const initialUrlRef = useRef(initialUrl);
	initialUrlRef.current = initialUrl;
	const navigateBrowserHistory = useTabsStore((s) => s.navigateBrowserHistory);
	const browserState = useTabsStore((s) => s.panes[paneId]?.browser);
	const historyIndex = browserState?.historyIndex ?? 0;
	const historyLength = browserState?.history.length ?? 0;
	const appZoomFactor = useZoomFactor();
	const appZoomFactorRef = useRef(appZoomFactor);
	appZoomFactorRef.current = appZoomFactor;
	const registrationRef = useRef<Promise<void>>(Promise.resolve());
	const nativeRegisteredRef = useRef(false);
	const nativeVisibilityRef = useRef<boolean | null>(null);
	const visibilityQueueRef = useRef<Promise<void>>(Promise.resolve());
	const visibleRef = useRef(visible);
	visibleRef.current = visible;
	const setNativeVisibility = useCallback(
		(nextVisible: boolean) => {
			const operation = visibilityQueueRef.current.then(async () => {
				await registrationRef.current;
				if (
					!nativeRegisteredRef.current ||
					nativeVisibilityRef.current === nextVisible
				)
					return;
				await electronTrpcClient.browser.setVisibility.mutate({
					paneId,
					visible: nextVisible,
				});
				nativeVisibilityRef.current = nextVisible;
			});
			visibilityQueueRef.current = operation.catch((error) => {
				console.error("[native-browser] visibility update failed", error);
			});
			return visibilityQueueRef.current;
		},
		[paneId],
	);

	useEffect(() => {
		const toNativeBounds = (element: HTMLElement) => {
			const bounds = rectFor(element);
			const zoom =
				Number.isFinite(appZoomFactorRef.current) &&
				appZoomFactorRef.current > 0
					? appZoomFactorRef.current
					: 1;
			return {
				x: bounds.x * zoom,
				y: bounds.y * zoom,
				width: bounds.width * zoom,
				height: bounds.height * zoom,
			};
		};
		const container = containerRef.current;
		if (!container) return;
		let disposed = false;
		const register = async () => {
			try {
			const existing = await electronTrpcClient.browser.getPageInfo.query({
				paneId,
			});
			if (existing) {
				await electronTrpcClient.browser.setVisibility.mutate({
					paneId,
					visible: false,
				});
				await electronTrpcClient.browser.setBounds.mutate({
					paneId,
					bounds: toNativeBounds(container),
				});
			} else {
				await electronTrpcClient.browser.register.mutate({
					paneId,
					url: initialUrlRef.current,
					bounds: toNativeBounds(container),
					visible: false,
				});
			}
				nativeRegisteredRef.current = true;
				nativeVisibilityRef.current = false;
				if (disposed) return;
			} catch (error) {
				console.error("[native-browser] register failed", error);
			}
		};
		registrationRef.current = register();
		const unsubscribePassthrough = pointerPassthrough.subscribe((active) => {
			void setNativeVisibility(visibleRef.current && !active);
		});
		const observer = new ResizeObserver(() => {
			if (disposed) return;
			void registrationRef.current.then(async () => {
				if (!nativeRegisteredRef.current) return;
				await electronTrpcClient.browser.setBounds.mutate({
					paneId,
					bounds: toNativeBounds(container),
				});
			});
		});
		observer.observe(container);

		const stateSub = electronTrpcClient.browser.onPaneState.subscribe(
			{ paneId },
			{
				onData: (state: unknown) => {
					if (!state || typeof state !== "object") return;
					const value = state as Record<string, unknown>;
					const store = useTabsStore.getState();
					const url = typeof value.url === "string" ? value.url : undefined;
					const title = typeof value.title === "string" ? value.title : "";
					if (url) {
						store.updateBrowserUrl(paneId, url, title);
						if (value.kind === "loadingFinished" && url !== "about:blank") {
							void electronTrpcClient.browserHistory.upsert.mutate({
								url,
								title,
								faviconUrl: null,
							});
						}
					}
					if (typeof value.isLoading === "boolean") {
						store.updateBrowserLoading(paneId, value.isLoading);
					}
				},
			},
		);
		const newWindowSub = electronTrpcClient.browser.onNewWindow.subscribe(
			{ paneId },
			{
				onData: ({ url }: { url: string }) => {
					const state = useTabsStore.getState();
					const pane = state.panes[paneId];
					const tab =
						pane && state.tabs.find((candidate) => candidate.id === pane.tabId);
					if (tab) state.openInBrowserPane(tab.workspaceId, url);
				},
			},
		);
		const closeSub = electronTrpcClient.browser.onClosePane.subscribe(
			{ paneId },
			{ onData: () => requestPaneClose(paneId) },
		);
		const reloadSub = electronTrpcClient.browser.onReloadPane.subscribe(
			{ paneId },
			{
				onData: () => void electronTrpcClient.browser.reload.mutate({ paneId }),
			},
		);
		return () => {
			disposed = true;
			unsubscribePassthrough();
			observer.disconnect();
			stateSub.unsubscribe();
			newWindowSub.unsubscribe();
			closeSub.unsubscribe();
			reloadSub.unsubscribe();
			void setNativeVisibility(false);
		};
	}, [paneId, setNativeVisibility]);

	useEffect(() => {
		void setNativeVisibility(visible && !pointerPassthrough.active);
	}, [setNativeVisibility, visible]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		void registrationRef.current.then(() => {
			if (!nativeRegisteredRef.current) return;
			const bounds = rectFor(container);
			void electronTrpcClient.browser.setBounds.mutate({
				paneId,
				bounds: {
					x: bounds.x * appZoomFactor,
					y: bounds.y * appZoomFactor,
					width: bounds.width * appZoomFactor,
					height: bounds.height * appZoomFactor,
				},
			});
		});
	}, [appZoomFactor, paneId]);

	const goBack = useCallback(() => {
		if (historyIndex > 0)
			void electronTrpcClient.browser.goBack.mutate({ paneId });
		else navigateBrowserHistory(paneId, "back");
	}, [historyIndex, navigateBrowserHistory, paneId]);
	const goForward = useCallback(() => {
		if (historyIndex < historyLength - 1)
			void electronTrpcClient.browser.goForward.mutate({ paneId });
		else navigateBrowserHistory(paneId, "forward");
	}, [historyIndex, historyLength, navigateBrowserHistory, paneId]);
	const reload = useCallback(() => {
		void electronTrpcClient.browser.reload.mutate({ paneId });
	}, [paneId]);
	const navigateTo = useCallback(
		(url: string) => {
			void electronTrpcClient.browser.navigate.mutate({ paneId, url });
		},
		[paneId],
	);

	return {
		containerRef,
		goBack,
		goForward,
		reload,
		navigateTo,
		canGoBack: historyIndex > 0,
		canGoForward: historyIndex < historyLength - 1,
	};
}

export function destroyPersistentWebview(paneId: string): void {
	void electronTrpcClient.browser.unregister.mutate({ paneId });
}
