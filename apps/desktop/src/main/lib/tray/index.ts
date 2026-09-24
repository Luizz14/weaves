import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { loadToken } from "lib/trpc/routers/auth/utils/auth-functions";
import { env } from "main/env.main";
import { checkForUpdatesInteractive } from "main/lib/auto-updater";
import {
	getHostServiceCoordinator,
	type HostServiceStatus,
	type HostServiceStatusEvent,
} from "main/lib/host-service-coordinator";
import { menuEmitter } from "main/lib/menu-events";
import { confirmAndQuitCompletely } from "main/lib/quit-completely";
import {
	getFocusedNativeWindow,
	invokeNative,
	onNativeEventNamed,
} from "main/native/platform";

type NativeTrayMenuItem = {
	label?: string;
	enabled?: boolean;
	type?: "separator";
	action?: string;
	submenu?: NativeTrayMenuItem[];
};

const PERSONAL_INSTALL_BUILD = process.env.TAURI_PERSONAL_INSTALL === "1";
const trayActions = new Map<string, () => void>();
let nextTrayActionId = 0;
let trayId: string | null = null;

function registerTrayAction(callback: () => void): string {
	const id = `tray-action-${++nextTrayActionId}`;
	trayActions.set(id, callback);
	return id;
}

onNativeEventNamed("tray:action", (event) => {
	const payload =
		typeof event.payload === "object" && event.payload !== null
			? (event.payload as { action?: unknown })
			: {};
	if (typeof payload.action === "string") trayActions.get(payload.action)?.();
});

function focusMainWindow(): void {
	const window = getFocusedNativeWindow();
	if (window) {
		window.show();
		window.focus();
	} else {
		void invokeNative("app.activate");
	}
}

function quitApp(): void {
	void invokeNative("app.quit");
}

function openSettings(): void {
	focusMainWindow();
	menuEmitter.emit("open-settings");
}

interface HostInfo {
	organizationName: string;
	version: string;
}

async function fetchHostInfo(organizationId: string): Promise<HostInfo | null> {
	const connection = getHostServiceCoordinator().getConnection(organizationId);
	if (!connection) return null;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 2000);
	try {
		const response = await fetch(
			`http://127.0.0.1:${connection.port}/trpc/host.info`,
			{
				headers: { Authorization: `Bearer ${connection.secret}` },
				signal: controller.signal,
			},
		);
		if (!response.ok) return null;
		const data = await response.json();
		const info = data?.result?.data?.json;
		if (!info?.organization?.name) return null;
		return {
			organizationName: info.organization.name,
			version: info.version ?? "",
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function statusLabel(status: HostServiceStatus): string {
	switch (status) {
		case "starting":
			return i18n._(msg({ message: "starting" }));
		case "running":
			return i18n._(msg({ message: "running" }));
		case "stopped":
			return i18n._(msg({ message: "stopped" }));
	}
}

function buildHostServiceSubmenu(
	orgIds: string[],
	infos: Map<string, HostInfo>,
): NativeTrayMenuItem[] {
	const coordinator = getHostServiceCoordinator();
	if (orgIds.length === 0) {
		return [
			{ label: i18n._(msg({ message: "No active services" })), enabled: false },
		];
	}
	const menuItems: NativeTrayMenuItem[] = [];
	for (const [index, orgId] of orgIds.entries()) {
		if (index > 0) menuItems.push({ type: "separator" });
		const status = coordinator.getProcessStatus(orgId);
		const info = infos.get(orgId);
		const label =
			info?.organizationName ??
			i18n._({
				...msg({ message: "Organization {id}" }),
				values: { id: orgId.slice(0, 8) },
			});
		const versionSuffix = info?.version ? ` (v${info.version})` : "";
		menuItems.push({ label, enabled: false });
		menuItems.push({
			label: `  ${statusLabel(status)}${versionSuffix}`,
			enabled: false,
		});
		menuItems.push({
			label: `  ${i18n._(msg({ message: "Restart" }))}`,
			enabled: status !== "starting",
			action: registerTrayAction(() => {
				void (async () => {
					try {
						const { token } = await loadToken();
						if (token) {
							await coordinator.restart(orgId, {
								authToken: token,
								cloudApiUrl: env.NEXT_PUBLIC_API_URL,
							});
						}
					} catch (error) {
						console.error(
							`[Tray] Failed to restart host-service for ${orgId}:`,
							error,
						);
					}
					void updateTrayMenu();
				})();
			}),
		});
		menuItems.push({
			label: `  ${i18n._(msg({ message: "Stop" }))}`,
			enabled: status === "running",
			action: registerTrayAction(() => {
				coordinator.stop(orgId);
				void updateTrayMenu();
			}),
		});
	}
	return menuItems;
}

async function updateTrayMenu(): Promise<void> {
	if (!trayId) return;
	const coordinator = getHostServiceCoordinator();
	const orgIds = coordinator.getActiveOrganizationIds();
	const infoEntries = await Promise.all(
		orgIds.map(async (orgId) => [orgId, await fetchHostInfo(orgId)] as const),
	);
	const infos = new Map<string, HostInfo>();
	for (const [orgId, info] of infoEntries) if (info) infos.set(orgId, info);
	if (!trayId) return;

	trayActions.clear();
	const hasActive = orgIds.length > 0;
	const hostServiceLabel = hasActive
		? i18n._({
				...msg({ message: "Host Service ({count})" }),
				values: { count: orgIds.length },
			})
		: i18n._(msg({ message: "Host Service" }));
	const items: NativeTrayMenuItem[] = [
		{
			label: hostServiceLabel,
			submenu: buildHostServiceSubmenu(orgIds, infos),
		},
		{ type: "separator" },
		{
			label: i18n._(msg({ message: "Open Superset" })),
			action: registerTrayAction(focusMainWindow),
		},
		{
			label: i18n._(msg({ message: "Settings" })),
			action: registerTrayAction(openSettings),
		},
		...(!PERSONAL_INSTALL_BUILD
			? ([
					{
						label: i18n._(msg({ message: "Check for Updates" })),
						action: registerTrayAction(checkForUpdatesInteractive),
					},
					{ type: "separator" },
				] satisfies NativeTrayMenuItem[])
			: []),
		{
			label: i18n._(msg({ message: "Close Superset" })),
			action: registerTrayAction(quitApp),
		},
		{ type: "separator" },
		{
			label: i18n._(msg({ message: "Quit Superset Completely" })),
			action: registerTrayAction(() => void confirmAndQuitCompletely()),
		},
	];
	void invokeNative("tray.setMenu", { trayId, items }).catch((error) => {
		console.error("[Tray] Failed to update native tray menu:", error);
	});
}

export function refreshTrayMenu(): void {
	if (trayId) void updateTrayMenu();
}

export function initTray(): void {
	if (trayId) {
		console.warn("[Tray] Already initialized");
		return;
	}
	if (process.platform !== "darwin") return;
	// Rust creates the one native tray during app initialization. The Node host
	// owns its business menu, but must not create a duplicate icon.
	trayId = "superset-tray";
	void updateTrayMenu();
	const manager = getHostServiceCoordinator();
	manager.on(
		"status-changed",
		(_event: HostServiceStatusEvent) => void updateTrayMenu(),
	);
	console.log("[Tray] Initialized successfully");
}

export function disposeTray(): void {
	if (!trayId) return;
	void invokeNative("tray.destroy", { trayId }).catch((error) => {
		console.error("[Tray] Failed to destroy native tray:", error);
	});
	trayId = null;
}
