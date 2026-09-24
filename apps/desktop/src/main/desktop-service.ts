import { join } from "node:path";
import { format } from "node:util";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { createTrpcContext } from "lib/trpc/context";
import type { AppRouter } from "lib/trpc/routers";
import { runQuitCleanup } from "main/lib/quit-sequence";
import {
	attachNativePeer,
	getAllNativeWindows,
	getNativeRuntimeMetadata,
	getNativeWindow,
	onNativeEventNamed,
	registerNativeWindow,
	showNativeMessageBox,
	waitForNativeBootstrap,
} from "main/native/platform";
import { createAppActivationHandler } from "./native/app-activation";
import { DEFAULT_CONFIRM_ON_QUIT } from "shared/constants";
import {
	EarlyDeepLinkEventBuffer,
	extractDeepLinks,
} from "./native/deep-links";
import { RpcDispatcher } from "./native/rpc-dispatcher/rpc-dispatcher";
import { type NativeRequest, StdioPeer } from "./native/stdio-peer/stdio-peer";

type ServiceModules = {
	localDb: typeof import("main/lib/local-db").localDb;
	initAppState: typeof import("main/lib/app-state").initAppState;
	initTanstackDbPersistence: typeof import("main/lib/persistence/persistence").initTanstackDbPersistence;
	shutdownTanstackDbPersistence: typeof import("main/lib/persistence/persistence").shutdownTanstackDbPersistence;
	getHostServiceCoordinator: typeof import("main/lib/host-service-coordinator").getHostServiceCoordinator;
	getTerminalHostClient: typeof import("main/lib/terminal-host/client").getTerminalHostClient;
	disposeTerminalHostClient: typeof import("main/lib/terminal-host/client").disposeTerminalHostClient;
	disposeTray: typeof import("main/lib/tray").disposeTray;
	initTray: typeof import("main/lib/tray").initTray;
	initAppServices: typeof import("main/windows/main").initAppServices;
	restoreWindows: typeof import("main/windows/main").restoreWindows;
	createPlatformWindow: typeof import("main/windows/main").createPlatformWindow;
	loadToken: typeof import("lib/trpc/routers/auth/utils/auth-functions").loadToken;
};

let serviceModules: ServiceModules | null = null;
let dispatcher: RpcDispatcher<AppRouter> | null = null;
let peer: StdioPeer | null = null;
let isQuitting = false;
let cleanupPromise: Promise<void> | null = null;
const earlyDeepLinkEvents = new EarlyDeepLinkEventBuffer();

function bufferDeepLinkEvent(
	event: import("main/native/platform").NativeEvent,
): void {
	if (earlyDeepLinkEvents.receive(event) === "dropped-oldest") {
		console.error(
			"[desktop-service] Deep-link startup buffer was full; the oldest event was dropped",
		);
	}
}

onNativeEventNamed("app:deepLink", bufferDeepLinkEvent);
onNativeEventNamed("deep-link", bufferDeepLinkEvent);

export async function requestQuitApproval({
	isDev,
	confirmOnQuit,
	showMessageBox = showNativeMessageBox,
}: {
	isDev: boolean;
	confirmOnQuit: boolean;
	showMessageBox?: (options: {
		type: "question";
		buttons: string[];
		defaultId: number;
		cancelId: number;
		title: string;
		message: string;
	}) => Promise<{ response: number }>;
}): Promise<{ allow: boolean }> {
	if (isDev || !confirmOnQuit) return { allow: true };
	try {
		const result = await showMessageBox({
			type: "question",
			buttons: [
				i18n._(msg({ message: "Quit" })),
				i18n._(msg({ message: "Cancel" })),
			],
			defaultId: 0,
			cancelId: 1,
			title: i18n._(msg({ message: "Quit Superset" })),
			message: i18n._(msg({ message: "Are you sure you want to quit?" })),
		});
		return { allow: result.response !== 1 };
	} catch (error) {
		console.error("[desktop-service] Quit confirmation failed:", error);
		return { allow: true };
	}
}

export async function observeDeepLinkProcessing(
	processing: Promise<void>,
	reportFailure: (message: string) => void = (message) =>
		console.error(message),
): Promise<void> {
	try {
		await processing;
	} catch {
		reportFailure("[desktop-service] Deep-link processing failed");
	}
}

function redirectLogsToStderr(): void {
	const target = process.stderr;
	for (const method of ["log", "info", "warn", "error", "debug"] as const) {
		const original = console[method].bind(console);
		console[method] = (...args: unknown[]) => {
			target.write(`${format(...args)}\n`);
		};
		void original;
	}
}

function registerExistingWindowLabels(): void {
	for (const window of getAllNativeWindows()) {
		registerNativeWindow({
			label: window.label,
			id: window.id,
			...window.getBounds(),
			zoomLevel: window.webContents.getZoomLevel(),
			focused: window.isFocused(),
		});
	}
}

async function initializeModules(): Promise<ServiceModules> {
	const metadata = getNativeRuntimeMetadata();
	if (!metadata) throw new Error("Native runtime metadata is unavailable");
	// SUPERSET_HOME_DIR remains the app-environment contract for SQLite,
	// app-state, window-state and agent manifests. Native userDataPath belongs to
	// the CEF profile and must never relocate those files.

	const [
		localDbModule,
		appStateModule,
		persistenceModule,
		hostCoordinatorModule,
		terminalClientModule,
		trayModule,
		windowsModule,
		authModule,
	] = await Promise.all([
		import("main/lib/local-db"),
		import("main/lib/app-state"),
		import("main/lib/persistence/persistence"),
		import("main/lib/host-service-coordinator"),
		import("main/lib/terminal-host/client"),
		import("main/lib/tray"),
		import("main/windows/main"),
		import("lib/trpc/routers/auth/utils/auth-functions"),
	]);

	return {
		localDb: localDbModule.localDb,
		initAppState: appStateModule.initAppState,
		initTanstackDbPersistence: persistenceModule.initTanstackDbPersistence,
		shutdownTanstackDbPersistence:
			persistenceModule.shutdownTanstackDbPersistence,
		getHostServiceCoordinator: hostCoordinatorModule.getHostServiceCoordinator,
		getTerminalHostClient: terminalClientModule.getTerminalHostClient,
		disposeTerminalHostClient: terminalClientModule.disposeTerminalHostClient,
		disposeTray: trayModule.disposeTray,
		initTray: trayModule.initTray,
		initAppServices: windowsModule.initAppServices,
		restoreWindows: windowsModule.restoreWindows,
		createPlatformWindow: windowsModule.createPlatformWindow,
		loadToken: authModule.loadToken,
	};
}

function handleNativeRequest(request: NativeRequest): Promise<unknown> {
	if (request.method === "app.quitRequested") {
		return (async () => {
			if (process.env.NODE_ENV === "development" || !serviceModules) {
				return { allow: true };
			}
			try {
				const { settings } = await import("@superset/local-db");
				const row = serviceModules.localDb.select().from(settings).get();
				return requestQuitApproval({
					isDev: false,
					confirmOnQuit: row?.confirmOnQuit ?? DEFAULT_CONFIRM_ON_QUIT,
				});
			} catch (error) {
				console.error("[desktop-service] Quit confirmation failed:", error);
			}
			return { allow: true };
		})();
	}
	if (request.method === "shutdown") {
		return (async () => {
			const params =
				typeof request.params === "object" && request.params !== null
					? (request.params as { preservePtySessions?: unknown })
					: {};
			const preservePtySessions = params.preservePtySessions !== false;
			await cleanup(!preservePtySessions, false);
			return { ok: true };
		})();
	}
	if (request.method === "window.closeRequested") {
		return (async () => {
			if (!serviceModules || process.env.NODE_ENV === "development") {
				return { allow: true };
			}
			const { settings } = await import("@superset/local-db");
			const row = serviceModules.localDb.select().from(settings).get();
			if (row?.confirmOnQuit !== true) return { allow: true };
			const result = await showNativeMessageBox(
				{
					type: "question",
					buttons: [
						i18n._(msg({ message: "Close Window" })),
						i18n._(msg({ message: "Cancel" })),
					],
					defaultId: 0,
					cancelId: 1,
					title: i18n._(msg({ message: "Close Superset" })),
					message: i18n._(
						msg({ message: "Are you sure you want to close this window?" }),
					),
				},
				request.windowLabel,
			);
			return { allow: result.response === 0 };
		})();
	}
	if (request.method !== "trpc") {
		return Promise.reject(
			new Error(`Unsupported Node host request: ${request.method}`),
		);
	}
	const windowLabel = request.windowLabel;
	if (!windowLabel)
		return Promise.reject(
			new Error("tRPC request has no trusted window label"),
		);
	if (!dispatcher) return Promise.reject(new Error("Node host is not ready"));
	// RpcDispatcher registers synchronously and executes asynchronously. The
	// response here is only an acknowledgement; the actual tRPC response is an
	// event named trpc:response scoped to the trusted window.
	dispatcher.handle(windowLabel, request.params);
	return Promise.resolve({ accepted: true });
}

function attachLifecycleHandlers(): void {
	onNativeEventNamed("window:closed", (event) => {
		if (event.windowLabel) dispatcher?.disposeWindow(event.windowLabel);
	});
	onNativeEventNamed("window:reloaded", (event) => {
		if (event.windowLabel) dispatcher?.disposeWindow(event.windowLabel);
	});
	onNativeEventNamed("window:reload", (event) => {
		if (event.windowLabel) dispatcher?.disposeWindow(event.windowLabel);
	});
	onNativeEventNamed("app:before-quit", (event) => {
		const payload =
			typeof event.payload === "object" && event.payload !== null
				? (event.payload as { forceFullCleanup?: unknown })
				: {};
		void cleanup(payload.forceFullCleanup === true, false);
	});
	process.once("SIGTERM", () => void cleanup(false));
	process.once("SIGINT", () => void cleanup(false));
}

async function configureAuthAndHosts(): Promise<void> {
	if (!serviceModules) throw new Error("Service modules are not initialized");
	const modules = serviceModules;
	const coordinator = modules.getHostServiceCoordinator();
	const { env: mainEnv } = await import("main/env.main");
	coordinator.setConfigProvider(async () => {
		const { token } = await modules.loadToken();
		return token
			? { authToken: token, cloudApiUrl: mainEnv.NEXT_PUBLIC_API_URL }
			: null;
	});

	let authGeneration = 0;
	const reconcile = async (provided?: {
		token: string;
		organizationIds: string[];
	}) => {
		const generation = authGeneration;
		const stored = provided ?? (await modules.loadToken());
		if (
			generation !== authGeneration ||
			!stored?.token ||
			!stored.organizationIds
		)
			return;
		await coordinator.reconcile(stored.organizationIds, {
			authToken: stored.token,
			cloudApiUrl: mainEnv.NEXT_PUBLIC_API_URL,
		});
	};

	const { authEvents } = await import(
		"lib/trpc/routers/auth/utils/auth-functions"
	);
	authEvents.on("token-saved", () => {
		authGeneration++;
		coordinator.stopAll();
	});
	authEvents.on("token-cleared", () => {
		authGeneration++;
		coordinator.stopAll();
	});
	authEvents.on(
		"organization-ids-saved",
		(data: { token: string; organizationIds: string[] }) => {
			authGeneration++;
			void reconcile(data).catch((error) =>
				console.error(
					"[desktop-service] host-service reconcile failed:",
					error,
				),
			);
		},
	);
	await reconcile().catch((error) =>
		console.error("[desktop-service] host-service reconcile failed:", error),
	);
}

async function initializeBusinessServices(): Promise<void> {
	if (!serviceModules) throw new Error("Service modules are not initialized");
	const { applyShellEnvToProcess } = await import(
		"lib/trpc/routers/workspaces/utils/shell-env"
	);
	await applyShellEnvToProcess();
	await serviceModules.initAppState();
	serviceModules.initTanstackDbPersistence();

	const { initI18nAsync } = await import("@superset/i18n");
	const { resolveAppLocale } = await import("main/lib/language");
	await initI18nAsync(resolveAppLocale(null));

	const { reconcileDaemonSessions, prewarmTerminalRuntime } = await import(
		"main/lib/terminal"
	);
	await reconcileDaemonSessions();
	prewarmTerminalRuntime();
	try {
		const { startBrowserBridge } = await import(
			"main/lib/browser/browser-bridge"
		);
		await startBrowserBridge();
		const { downloadManager } = await import(
			"main/lib/browser/download-manager"
		);
		downloadManager.start();
	} catch (error) {
		console.error("[desktop-service] Browser services failed to start:", error);
	}

	const { sweepNetworkLogs } = await import("main/network-logger-sweep");
	const { sweepDevAppProfiles } = await import("main/dev-app-profile-sweep");
	sweepNetworkLogs();
	sweepDevAppProfiles();

	await configureAuthAndHosts();

	try {
		const setup = await import("@superset/agent-setup");
		const { settings } = await import("@superset/local-db");
		const row = serviceModules.localDb.select().from(settings).get();
		setup.setAgentSetupTemplatesDir(join(__dirname, "templates"));
		setup.writeSharedDisabledAgentIds(row?.disabledAgentHooks ?? []);
		setup.writeSharedDisabledSkillIds(row?.disabledSkills ?? []);
		setup.setupAgentIntegrations({
			disabledAgentIds: row?.disabledAgentHooks ?? [],
			disabledSkillIds: row?.disabledSkills ?? [],
		});
	} catch (error) {
		console.error("[desktop-service] Agent setup failed:", error);
	}

	try {
		const { syncInstalledPluginMcpServers } = await import(
			"main/lib/plugin-installs"
		);
		syncInstalledPluginMcpServers();
	} catch (error) {
		console.error("[desktop-service] Plugin sync failed:", error);
	}
	try {
		const { installBundledCliShim } = await import("main/lib/bundled-cli");
		installBundledCliShim();
	} catch (error) {
		console.error("[desktop-service] Bundled CLI setup failed:", error);
	}

	const modules = serviceModules;
	modules.initAppServices();
	registerExistingWindowLabels();
	await modules.restoreWindows();
	onNativeEventNamed(
		"app:activate",
		createAppActivationHandler({
			getWindows: getAllNativeWindows,
			createWindow: () => modules.createPlatformWindow({ orgId: null }),
		}),
	);
	modules.initTray();
	const { setupAutoUpdater } = await import("main/lib/auto-updater");
	setupAutoUpdater();
	const { handleAuthCallback, parseAuthDeepLink } = await import(
		"lib/trpc/routers/auth/utils/auth-functions"
	);
	const { getFocusedNativeWindow } = await import("main/native/platform");
	const processDeepLink = async (
		url: string,
		trustedWindowLabel?: string,
	): Promise<void> => {
		const target = trustedWindowLabel
			? getNativeWindow(trustedWindowLabel)
			: (getFocusedNativeWindow() ?? getAllNativeWindows()[0]);
		target?.show();
		target?.focus();
		const authLink = parseAuthDeepLink(url);
		if (authLink.type !== "not-auth") {
			const result =
				authLink.type === "valid"
					? await handleAuthCallback(authLink.params)
					: {
							success: false as const,
							error: "sign-in link was missing required parameters",
						};
			if (!result.success) {
				await showNativeMessageBox(
					{
						type: "error",
						title: i18n._(msg({ message: "Sign-in failed" })),
						message:
							result.error ??
							i18n._(
								msg({
									message:
										"Superset could not complete sign-in. Please try again.",
								}),
							),
					},
					trustedWindowLabel,
				);
			}
			return;
		}
		target?.webContents.send("deep-link-navigate", `/${url.split("://")[1]}`);
	};
	const onDeepLink = (event: import("main/native/platform").NativeEvent) => {
		for (const url of extractDeepLinks(event.payload)) {
			void observeDeepLinkProcessing(processDeepLink(url, event.windowLabel));
		}
	};
	earlyDeepLinkEvents.activate(onDeepLink);
}

async function cleanup(force: boolean, exitProcess = true): Promise<void> {
	if (cleanupPromise) return cleanupPromise;
	cleanupPromise = (async () => {
		if (isQuitting) return;
		isQuitting = true;
		if (!serviceModules) return;
		dispatcher?.dispose();
		const terminalClient = serviceModules.getTerminalHostClient();
		const { isUpdateReadyToInstall } = await import("main/lib/auto-updater");
		await runQuitCleanup({
			isDev: process.env.NODE_ENV === "development",
			forceFullCleanup: force,
			isUpdateInstalling: !force && isUpdateReadyToInstall(),
			stopHostServices: () =>
				serviceModules?.getHostServiceCoordinator().stopAll(),
			teardownTerminalHost: async () => {
				await terminalClient.shutdownIfRunning({ killSessions: true });
				serviceModules?.disposeTerminalHostClient();
			},
			disposeTerminalHostClient: () =>
				serviceModules?.disposeTerminalHostClient(),
			shutdownPersistence: serviceModules.shutdownTanstackDbPersistence,
			disposeTray: serviceModules.disposeTray,
			forceExit: (code) => {
				process.exitCode = code;
				if (exitProcess && isQuitting) process.exit(code);
			},
		});
	})();
	return cleanupPromise;
}

export async function startDesktopService(): Promise<void> {
	redirectLogsToStderr();
	const nextPeer = new StdioPeer(
		process.stdin,
		process.stdout,
		handleNativeRequest,
		(error) => {
			console.error("[desktop-service] Native transport closed:", error);
			dispatcher?.dispose();
			void cleanup(false).finally(() => {
				process.exitCode = 1;
			});
		},
	);
	peer = nextPeer;
	attachNativePeer(nextPeer);
	const metadata = await waitForNativeBootstrap();
	console.error(
		`[desktop-service] Bootstrap ${metadata.appName} ${metadata.version} (${metadata.platform}/${metadata.arch})`,
	);
	serviceModules = await initializeModules();
	await initializeBusinessServices();
	const { createAppRouter } = await import("lib/trpc/routers");

	const router = createAppRouter(() => {
		const windows = getAllNativeWindows();
		return windows.find((window) => window.isFocused()) ?? windows[0] ?? null;
	});
	dispatcher = new RpcDispatcher(
		router,
		(windowLabel) => createTrpcContext(windowLabel),
		(windowLabel, response) =>
			nextPeer.emit("trpc:response", response, windowLabel),
		(error) => {
			console.error(
				"[desktop-service] Failed to deliver tRPC response:",
				error,
			);
			nextPeer.close(error instanceof Error ? error : new Error(String(error)));
		},
	);
	attachLifecycleHandlers();
	nextPeer.emit("ready", {
		schemaVersion: 1,
		appVersion: metadata.version,
	});
}

const isDesktopServiceEntry =
	process.argv[1]?.endsWith("desktop-service.cjs") === true ||
	process.argv[1]?.endsWith("desktop-service.ts") === true;

if (isDesktopServiceEntry) {
	void startDesktopService().catch((error) => {
		console.error("[desktop-service] Fatal startup failure:", error);
		peer?.close(error instanceof Error ? error : new Error(String(error)));
		process.exitCode = 1;
	});
}
