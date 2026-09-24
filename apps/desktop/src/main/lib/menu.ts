import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { COMPANY } from "@superset/shared/constants";
import { env } from "main/env.main";
import { dispatchNativeMenuClick } from "main/lib/menu-action-router";
import { resetTerminalStateDev } from "main/lib/terminal/dev-reset";
import {
	getAllNativeWindows,
	getFocusedNativeWindow,
	getNativeAppName,
	invokeNative,
	onNativeEventNamed,
} from "main/native/platform";
import {
	checkForUpdatesInteractive,
	simulateDownloading,
	simulateError,
	simulateUpdateReady,
} from "./auto-updater";
import { menuEmitter } from "./menu-events";
import { confirmAndQuitCompletely } from "./quit-completely";

type NativeMenuItem = {
	label?: string;
	role?: string;
	type?: "separator";
	action?: string;
	accelerator?: string;
	registerAccelerator?: boolean;
	submenu?: NativeMenuItem[];
};

const PERSONAL_INSTALL_BUILD = process.env.TAURI_PERSONAL_INSTALL === "1";
const menuActions = new Map<string, () => void>();
let nextMenuActionId = 0;

function registerMenuAction(callback: () => void): string {
	const id = `menu-action-${++nextMenuActionId}`;
	menuActions.set(id, callback);
	return id;
}

onNativeEventNamed("menu:action", (event) => {
	const payload =
		typeof event.payload === "object" && event.payload !== null
			? (event.payload as { action?: unknown })
			: {};
	if (typeof payload.action === "string") menuActions.get(payload.action)?.();
});

// Native tray/menu fallbacks use stable semantic ids instead of the dynamic
// action tokens sent by menu.setApplicationMenu. Keep both paths equivalent.
onNativeEventNamed("menu:clicked", (event) => {
	const payload =
		typeof event.payload === "object" && event.payload !== null
			? (event.payload as { id?: unknown })
			: {};
	if (typeof payload.id === "string")
		dispatchNativeMenuClick(payload.id, {
			emit: menuEmitter.emit.bind(menuEmitter),
			checkUpdates: checkForUpdatesInteractive,
			quit: () => {
				void invokeNative("app.quit");
			},
			quitCompletely: () => void confirmAndQuitCompletely(),
		});
});

export function createApplicationMenu() {
	const reloadAccelerator = "CmdOrCtrl+R";
	const closeAccelerator = "CmdOrCtrl+Shift+Q";
	const showHotkeysAccelerator = "CmdOrCtrl+/";
	const openSettingsAccelerator = "CmdOrCtrl+,";
	// macOS/VS Code convention for New Window. On Windows/Linux Ctrl+Shift+N is
	// already New Workspace, so use Ctrl+Alt+N there.
	const newWindowAccelerator =
		process.platform === "darwin" ? "Cmd+Shift+N" : "Ctrl+Alt+N";

	menuActions.clear();
	const template: NativeMenuItem[] = [
		{
			label: i18n._(msg({ message: "File" })),
			submenu: [
				{
					label: i18n._(
						msg({
							message: "New Window",
						}),
					),
					accelerator: newWindowAccelerator,
					action: registerMenuAction(() => {
						menuEmitter.emit("new-window");
					}),
				},
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Open Repo...",
						}),
					),
					accelerator: "CmdOrCtrl+O",
					action: registerMenuAction(() => {
						menuEmitter.emit("open-project");
					}),
				},
				{ type: "separator" },
				// Explicit click handler (not `role: "close"`) — `role: "close"` adds
				// an implicit CmdOrCtrl+W accelerator that overrides browser-manager's
				// `before-input-event` interception and closes the window instead of
				// the focused pane.
				{
					label: i18n._(
						msg({
							message: "Close Window",
						}),
					),
					action: registerMenuAction(() => {
						getFocusedNativeWindow()?.close();
					}),
				},
				// macOS keeps these in the application menu, which only it has.
				...(process.platform === "darwin"
					? []
					: ([
							{ type: "separator" },
							{
								label: i18n._(msg({ message: "Settings..." })),
								accelerator: openSettingsAccelerator,
								action: registerMenuAction(() => {
									menuEmitter.emit("open-settings");
								}),
							},
							...(!PERSONAL_INSTALL_BUILD
								? ([
										{
											label: i18n._(msg({ message: "Check for Updates..." })),
											action: registerMenuAction(() => {
												checkForUpdatesInteractive();
											}),
										},
										{ type: "separator" },
									] satisfies NativeMenuItem[])
								: []),
							{ role: "quit" },
							{
								label: i18n._(msg({ message: "Quit Superset Completely" })),
								action: registerMenuAction(() => {
									void confirmAndQuitCompletely();
								}),
							},
						] satisfies NativeMenuItem[])),
			],
		},
		{
			label: i18n._(msg({ message: "Edit" })),
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: i18n._(msg({ message: "View", context: "menu" })),
			submenu: [
				{
					label: i18n._(msg({ message: "Reload" })),
					accelerator: reloadAccelerator,
					action: registerMenuAction(() => {
						getFocusedNativeWindow()?.webContents.reload();
					}),
				},
				// Explicit click handler (not `role: "forceReload"`) — the role adds
				// an implicit CmdOrCtrl+Shift+R accelerator that prevents the renderer's
				// Reopen Closed Tab shortcut from receiving the event.
				{
					label: i18n._(
						msg({
							message: "Force Reload",
						}),
					),
					action: registerMenuAction(() => {
						getFocusedNativeWindow()?.webContents.reloadIgnoringCache();
					}),
				},
				{ role: "toggleDevTools" },
				{ type: "separator" },
				// Display-only accelerators: the renderer owns ZOOM_IN/ZOOM_OUT/
				// ZOOM_RESET so a focused terminal zooms its font and a focused
				// browser pane zooms its page. Registering them here would fire
				// the role (page zoom) before the renderer ever sees the key.
				{ role: "resetZoom", registerAccelerator: false },
				{ role: "zoomIn", registerAccelerator: false },
				{ role: "zoomOut", registerAccelerator: false },
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Toggle Scripts Bar",
						}),
					),
					action: registerMenuAction(() => {
						menuEmitter.emit("toggle-presets-bar");
					}),
				},
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: i18n._(msg({ message: "Window" })),
			// macOS appends the list of open windows to a windowMenu-role menu,
			// which is how you switch between platform windows. Without the role
			// the list never appears, so multi-window has no switcher.
			role: process.platform === "darwin" ? "windowMenu" : undefined,
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				{ type: "separator" },
				{ role: "close", accelerator: closeAccelerator },
			],
		},
		{
			label: i18n._(msg({ message: "Resources" })),
			submenu: [
				// No accelerator here: on macOS, a menu accelerator is always live
				// and would bypass the renderer's user-customizable CHECK_RESOURCES
				// binding (Settings > Keyboard). The default shortcut stays
				// discoverable via the command palette and keyboard settings, both
				// of which reflect the user's actual current/overridden binding.
				{
					label: i18n._(
						msg({
							message: "Check Resources",
						}),
					),
					action: registerMenuAction(() => {
						menuEmitter.emit("check-resources");
					}),
				},
			],
		},
		{
			label: i18n._(msg({ message: "Help" })),
			submenu: [
				{
					label: i18n._(
						msg({
							message: "Documentation",
						}),
					),
					action: registerMenuAction(() => {
						void invokeNative("shell.openExternal", { url: COMPANY.DOCS_URL });
					}),
				},
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Contact Us",
						}),
					),
					action: registerMenuAction(() => {
						void invokeNative("shell.openExternal", { url: COMPANY.MAIL_TO });
					}),
				},
				{
					label: i18n._(
						msg({
							message: "Report Issue",
						}),
					),
					action: registerMenuAction(() => {
						void invokeNative("shell.openExternal", {
							url: COMPANY.REPORT_ISSUE_URL,
						});
					}),
				},
				{
					label: i18n._(
						msg({
							message: "Join Discord",
						}),
					),
					action: registerMenuAction(() => {
						void invokeNative("shell.openExternal", {
							url: COMPANY.DISCORD_URL,
						});
					}),
				},
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Keyboard Shortcuts",
						}),
					),
					accelerator: showHotkeysAccelerator,
					action: registerMenuAction(() => {
						menuEmitter.emit("open-settings", "keyboard");
					}),
				},
			],
		},
	];

	// DEV ONLY: Add Dev menu
	if (env.NODE_ENV === "development") {
		template.push({
			label: "Dev",
			submenu: [
				{
					label: "Reset Terminal State",
					action: registerMenuAction(() => {
						resetTerminalStateDev()
							.then(() => {
								for (const window of getAllNativeWindows()) {
									window.webContents.reload();
								}
							})
							.catch((error) => {
								console.error("[menu] Failed to reset terminal state:", error);
							});
					}),
				},
				{ type: "separator" },
				{
					label: "Simulate Update Downloading",
					action: registerMenuAction(() => simulateDownloading()),
				},
				{
					label: "Simulate Update Ready",
					action: registerMenuAction(() => simulateUpdateReady()),
				},
				{
					label: "Simulate Update Error",
					action: registerMenuAction(() => simulateError()),
				},
			],
		});
	}

	if (process.platform === "darwin") {
		template.unshift({
			label: getNativeAppName(),
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{
					label: i18n._(
						msg({
							message: "Settings...",
						}),
					),
					accelerator: openSettingsAccelerator,
					action: registerMenuAction(() => {
						menuEmitter.emit("open-settings");
					}),
				},
				...(!PERSONAL_INSTALL_BUILD
					? ([
							{
								label: i18n._(
									msg({
										message: "Check for Updates...",
									}),
								),
								action: registerMenuAction(() => {
									checkForUpdatesInteractive();
								}),
							},
							{ type: "separator" },
						] satisfies NativeMenuItem[])
					: []),
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
				{
					label: i18n._(
						msg({
							message: "Quit Superset Completely",
						}),
					),
					action: registerMenuAction(() => {
						void confirmAndQuitCompletely();
					}),
				},
			],
		});
	}

	void invokeNative("menu.setApplicationMenu", { template }).catch((error) => {
		console.error("[menu] Failed to configure native application menu:", error);
	});
}
