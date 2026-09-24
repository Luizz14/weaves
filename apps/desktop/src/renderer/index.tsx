import { createRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import ReactDom from "react-dom/client";
import { BootErrorBoundary } from "./components/BootErrorBoundary";
import { RendererRouter } from "./components/RendererRouter";
import {
	cleanupBootErrorHandling,
	initBootErrorHandling,
	isBootErrorReported,
	markBootMounted,
	reportBootError,
} from "./lib/boot-errors";
import {
	disposeDesktopBridge,
	initializeDesktopBridge,
	invokeNative,
	subscribeDesktopEvent,
} from "./lib/native-bridge";
import { sweepDeadPersistedKeys } from "./lib/persisted-keys";
import { persistentHistory } from "./lib/persistent-hash-history";
import { posthog } from "./lib/posthog";
import { initSentry } from "./lib/sentry";
import { pruneExpiredTerminalState } from "./lib/terminal/terminal-buffer-gc";
import { electronQueryClient } from "./providers/ElectronTRPCProvider";
import { NotFound } from "./routes/not-found";
import { routeTree } from "./routeTree.gen";

import "./globals.css";
import "./styles/bundled-fonts.css";

initSentry();

const rootElement = document.querySelector("app");
initBootErrorHandling(rootElement);

const createRendererRouter = () =>
	createRouter({
		routeTree,
		history: persistentHistory,
		defaultPreload: "intent",
		defaultNotFoundComponent: NotFound,
		context: {
			queryClient: electronQueryClient,
		},
	});

type RendererRouterInstance = ReturnType<typeof createRendererRouter>;
let router: RendererRouterInstance | null = null;
let unsubscribe = () => {};

const handleDeepLink = (path: string) => {
	console.log("[deep-link] Navigating to:", path);
	void router?.navigate({ to: path });
};

function RendererReadySignal() {
	useEffect(() => {
		void invokeNative("app.rendererReady", null).catch((error: unknown) => {
			console.error("[renderer] failed to signal native readiness", error);
		});
	}, []);
	return null;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: RendererRouterInstance;
	}
}

const bootstrapRenderer = async (): Promise<void> => {
	await initializeDesktopBridge();
	// Run cleanup only after the native bridge has completed profile/bootstrap
	// migration. Tauri's origin differs from Electron's file:// origin, so an
	// early sweep could make a migrated profile look empty and discard state.
	// Before any terminal mounts: unbounded persisted scrollback wedged the
	// renderer once it grew to hundreds of orphaned buffers (23.7 MB observed).
	pruneExpiredTerminalState();
	// Keys from removed features otherwise live on user profiles forever.
	sweepDeadPersistedKeys();

	router = createRendererRouter();
	const rendererRouter = router;
	unsubscribe = rendererRouter.subscribe("onResolved", (event) => {
		posthog.capture("$pageview", {
			$current_url: event.toLocation.pathname,
			$pathname: event.toLocation.pathname,
		});
	});

	const unsubscribeDeepLink = subscribeDesktopEvent(
		"deep-link-navigate",
		(payload) => {
			if (typeof payload === "string") handleDeepLink(payload);
		},
	);

	if (!rootElement) {
		reportBootError("Missing <app> root element");
	} else if (!isBootErrorReported()) {
		ReactDom.createRoot(rootElement).render(
			<BootErrorBoundary
				onError={(error) => reportBootError("Render failed", error)}
			>
				<RendererRouter router={rendererRouter} />
				<RendererReadySignal />
			</BootErrorBoundary>,
		);
		markBootMounted();
		if (process.env.NODE_ENV !== "production") {
			void import("./lib/react-devtools-frontend")
				.then(({ mountReactDevTools }) => mountReactDevTools())
				.catch((error: unknown) =>
					console.warn(
						"[react-devtools] Failed to mount inline DevTools",
						error,
					),
				);
		}
	}

	if (import.meta.hot) {
		import.meta.hot.dispose(() => {
			unsubscribe();
			unsubscribeDeepLink();
			void disposeDesktopBridge();
			cleanupBootErrorHandling();
		});
	}
};

void bootstrapRenderer().catch((error: unknown) => {
	reportBootError("Render failed", error);
});
