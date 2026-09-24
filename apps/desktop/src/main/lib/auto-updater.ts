import { EventEmitter } from "node:events";
import { statfsSync } from "node:fs";
import { msg } from "@lingui/core/macro";
import * as Sentry from "@sentry/node";
import { i18n } from "@superset/i18n";
import { env } from "main/env.main";
import { appState } from "main/lib/app-state";
import {
	isEnvironmentUpdateError,
	isUpstreamServerError,
} from "main/lib/update-error-classification";
import { redactUpdateError } from "main/lib/update-error-redaction";
import {
	getNativeAppVersion,
	getNativePath,
	invokeNative,
	onNativeEventNamed,
	showNativeMessageBox,
} from "main/native/platform";
import { prerelease } from "semver";
import {
	AUTO_UPDATE_STATUS,
	type AutoUpdateProgress,
	type AutoUpdateStatus,
	type AutoUpdateStatusEvent,
} from "shared/auto-update";
import { PLATFORM } from "shared/constants";

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 4;
const PERSONAL_INSTALL_BUILD = process.env.TAURI_PERSONAL_INSTALL === "1";
const IS_PRERELEASE = prerelease(getNativeAppVersion()) !== null;
const IS_AUTO_UPDATE_PLATFORM = PLATFORM.IS_MAC || PLATFORM.IS_LINUX;

export function getUpdateManifestUrl(isPrerelease: boolean): string {
	return isPrerelease
		? "https://github.com/superset-sh/superset/releases/download/desktop-canary/canary.json"
		: "https://github.com/superset-sh/superset/releases/latest/download/latest.json";
}

const UPDATE_FEED_URL = getUpdateManifestUrl(IS_PRERELEASE);

export type { AutoUpdateStatusEvent } from "shared/auto-update";
export const autoUpdateEmitter = new EventEmitter();

const SILENT_ERROR_PATTERNS = [
	"net::ERR_",
	"ENOTFOUND",
	"ETIMEDOUT",
	"ECONNREFUSED",
	"ECONNRESET",
];

function isNetworkError(error: Error | string): boolean {
	const message = typeof error === "string" ? error : error.message;
	if (message.includes("net::ERR_CERT_")) return false;
	return SILENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function isTransientError(error: Error): boolean {
	return isNetworkError(error) || isUpstreamServerError(error);
}

function freeStagingBytes(): number | null {
	try {
		const { bavail, bsize } = statfsSync(getNativePath("userData"));
		return bavail * bsize;
	} catch {
		return null;
	}
}

function isUpdateCheckDisabledByEnvironment(): boolean {
	return PLATFORM.IS_MAC && process.env.DISABLE_UPDATE_CHECK !== undefined;
}

let currentStatus: AutoUpdateStatus = AUTO_UPDATE_STATUS.IDLE;
let currentVersion: string | undefined;
let currentError: string | undefined;
let currentProgress: AutoUpdateProgress | undefined;
let isDismissed = false;
let isInstalling = false;
let updaterConfigured = false;

function emitStatus(
	status: AutoUpdateStatus,
	version?: string,
	error?: string,
	progress?: AutoUpdateProgress,
): void {
	currentStatus = status;
	currentVersion = version;
	currentError = error;
	currentProgress = progress;
	if (isDismissed && status === AUTO_UPDATE_STATUS.READY) return;
	autoUpdateEmitter.emit("status-changed", {
		status,
		version,
		error,
		progress,
	} satisfies AutoUpdateStatusEvent);
}

function payloadRecord(payload: unknown): Record<string, unknown> {
	return typeof payload === "object" && payload !== null
		? (payload as Record<string, unknown>)
		: {};
}

function handleNativeUpdaterEvent(payload: unknown): void {
	const value = payloadRecord(payload);
	const status = value.status;
	if (typeof status !== "string") return;
	if (!Object.values(AUTO_UPDATE_STATUS).includes(status as AutoUpdateStatus)) {
		console.error("[auto-updater] Native host sent unknown status:", status);
		return;
	}
	const progress = payloadRecord(value.progress);
	emitStatus(
		status as AutoUpdateStatus,
		typeof value.version === "string" ? value.version : undefined,
		typeof value.error === "string" ? value.error : undefined,
		Object.keys(progress).length > 0
			? {
					percent: Number(progress.percent),
					transferredBytes: Number(progress.transferredBytes),
					totalBytes: Number(progress.totalBytes),
				}
			: undefined,
	);
	if (status === AUTO_UPDATE_STATUS.ERROR) isInstalling = false;
	if (status === AUTO_UPDATE_STATUS.READY) isInstalling = false;
}

onNativeEventNamed("updater:status", (event) =>
	handleNativeUpdaterEvent(event.payload),
);
onNativeEventNamed("updater:error", (event) => {
	const value = payloadRecord(event.payload);
	const message =
		typeof value.message === "string" ? value.message : "Native updater failed";
	isInstalling = false;
	const error = new Error(message);
	if (isTransientError(error)) {
		emitStatus(AUTO_UPDATE_STATUS.IDLE);
		return;
	}
	const freeBytes = freeStagingBytes();
	emitStatus(AUTO_UPDATE_STATUS.ERROR, undefined, message);
	if (!isEnvironmentUpdateError(message, freeBytes)) {
		Sentry.captureException(redactUpdateError(error), {
			contexts: { update_staging: { free_bytes: freeBytes } },
		});
	}
});

export function getUpdateStatus(): AutoUpdateStatusEvent {
	if (isDismissed && currentStatus === AUTO_UPDATE_STATUS.READY) {
		return { status: AUTO_UPDATE_STATUS.IDLE };
	}
	return {
		status: currentStatus,
		version: currentVersion,
		error: currentError,
		progress: currentProgress,
	};
}

export function isUpdateReadyToInstall(): boolean {
	return isInstalling || currentStatus === AUTO_UPDATE_STATUS.READY;
}

export function installUpdate(): void {
	if (env.NODE_ENV === "development") {
		const installedVersion = currentVersion;
		setTimeout(() => {
			emitStatus(AUTO_UPDATE_STATUS.UPDATED, installedVersion);
			setTimeout(() => emitStatus(AUTO_UPDATE_STATUS.IDLE), 6000);
		}, 3500);
		return;
	}
	if (isInstalling || currentStatus !== AUTO_UPDATE_STATUS.READY) return;
	isInstalling = true;
	void invokeNative("updater.install", { restart: true }).catch((error) => {
		isInstalling = false;
		emitStatus(
			AUTO_UPDATE_STATUS.ERROR,
			undefined,
			error instanceof Error ? error.message : String(error),
		);
	});
}

export function dismissUpdate(): void {
	isDismissed = true;
	autoUpdateEmitter.emit("status-changed", { status: AUTO_UPDATE_STATUS.IDLE });
}

export function checkForUpdates(): void {
	if (env.NODE_ENV === "development" || !IS_AUTO_UPDATE_PLATFORM) return;
	if (PERSONAL_INSTALL_BUILD) return;
	if (isUpdateCheckDisabledByEnvironment() || isUpdateReadyToInstall()) return;
	if (!updaterConfigured) setupAutoUpdater();
	isDismissed = false;
	emitStatus(AUTO_UPDATE_STATUS.CHECKING);
	void invokeNative("updater.check", { feedUrl: UPDATE_FEED_URL }).catch(
		(error) => {
			const normalized =
				error instanceof Error ? error : new Error(String(error));
			if (isTransientError(normalized)) {
				emitStatus(AUTO_UPDATE_STATUS.IDLE);
				return;
			}
			emitStatus(AUTO_UPDATE_STATUS.ERROR, undefined, normalized.message);
		},
	);
}

export function checkForUpdatesInteractive(): void {
	if (PERSONAL_INSTALL_BUILD) return;
	if (env.NODE_ENV === "development") {
		void showNativeMessageBox({
			type: "info",
			title: i18n._(msg({ message: "Updates" })),
			message: i18n._(
				msg({ message: "Auto-updates are disabled in development mode." }),
			),
		});
		return;
	}
	if (!IS_AUTO_UPDATE_PLATFORM) {
		void showNativeMessageBox({
			type: "info",
			title: i18n._(msg({ message: "Updates" })),
			message: i18n._(
				msg({ message: "Auto-updates are only available on macOS and Linux." }),
			),
		});
		return;
	}
	if (isUpdateCheckDisabledByEnvironment()) {
		void showNativeMessageBox({
			type: "info",
			title: i18n._(msg({ message: "Updates" })),
			message: i18n._(
				msg({
					message:
						"Auto-updates are disabled by the DISABLE_UPDATE_CHECK environment variable.",
				}),
			),
		});
		return;
	}
	if (isUpdateReadyToInstall()) {
		void showNativeMessageBox({
			type: "info",
			title: i18n._(msg({ message: "Updates" })),
			message: i18n._(msg({ message: "An update is ready to install." })),
			detail: i18n._({
				...msg({
					message: "Version {version} installs the next time you restart.",
				}),
				values: { version: currentVersion },
			}),
		});
		return;
	}
	checkForUpdates();
}

const SIMULATED_VERSION = "99.0.0-test";
let simulateDownloadInterval: NodeJS.Timeout | undefined;

function clearSimulatedDownload(): void {
	if (simulateDownloadInterval) clearInterval(simulateDownloadInterval);
	simulateDownloadInterval = undefined;
}

export function simulateUpdateReady(): void {
	if (env.NODE_ENV !== "development") return;
	isDismissed = false;
	clearSimulatedDownload();
	emitStatus(AUTO_UPDATE_STATUS.READY, SIMULATED_VERSION);
}

export function simulateDownloading(): void {
	if (env.NODE_ENV !== "development") return;
	isDismissed = false;
	clearSimulatedDownload();
	emitStatus(AUTO_UPDATE_STATUS.DOWNLOADING, SIMULATED_VERSION);
	const totalBytes = 48 * 1024 * 1024;
	let percent = 0;
	simulateDownloadInterval = setInterval(() => {
		percent = Math.min(percent + 3 + Math.random() * 5, 100);
		emitStatus(AUTO_UPDATE_STATUS.DOWNLOADING, SIMULATED_VERSION, undefined, {
			percent,
			transferredBytes: Math.round((percent / 100) * totalBytes),
			totalBytes,
		});
		if (percent >= 100) {
			clearSimulatedDownload();
			emitStatus(AUTO_UPDATE_STATUS.READY, SIMULATED_VERSION);
		}
	}, 300);
}

export function simulateError(): void {
	if (env.NODE_ENV !== "development") return;
	isDismissed = false;
	clearSimulatedDownload();
	emitStatus(
		AUTO_UPDATE_STATUS.ERROR,
		undefined,
		"Simulated error for testing",
	);
}

export function setupAutoUpdater(): void {
	if (
		updaterConfigured ||
		PERSONAL_INSTALL_BUILD ||
		env.NODE_ENV === "development" ||
		!IS_AUTO_UPDATE_PLATFORM
	)
		return;
	updaterConfigured = true;
	void invokeNative("updater.configure", {
		feedUrl: UPDATE_FEED_URL,
		channel: IS_PRERELEASE ? "canary" : "stable",
		autoDownload: true,
		autoInstallOnAppQuit: true,
		allowDowngrade: IS_PRERELEASE,
	}).catch((error) => {
		console.error("[auto-updater] Native updater configuration failed:", error);
		emitStatus(
			AUTO_UPDATE_STATUS.ERROR,
			undefined,
			error instanceof Error ? error.message : String(error),
		);
	});
	const lastRunVersion = appState.data.lastRunVersion;
	const currentAppVersion = getNativeAppVersion();
	const justUpdated = !!lastRunVersion && lastRunVersion !== currentAppVersion;
	if (justUpdated) emitStatus(AUTO_UPDATE_STATUS.UPDATED, currentAppVersion);
	if (lastRunVersion !== currentAppVersion) {
		appState.data.lastRunVersion = currentAppVersion;
		void appState.write();
	}
	const interval = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
	interval.unref();
	setTimeout(checkForUpdates, justUpdated ? 10_000 : 0);
}
