export interface NativeMenuActionHandlers {
	emit: (event: string, ...args: unknown[]) => unknown;
	checkUpdates: () => void;
	quit: () => void;
	quitCompletely: () => void;
}

export function dispatchNativeMenuClick(
	id: string,
	handlers: NativeMenuActionHandlers,
): void {
	switch (id) {
		case "new-window":
			handlers.emit("new-window");
			break;
		case "open-project":
			handlers.emit("open-project");
			break;
		case "settings":
			handlers.emit("open-settings");
			break;
		case "check-updates":
			handlers.checkUpdates();
			break;
		case "toggle-presets-bar":
			handlers.emit("toggle-presets-bar");
			break;
		case "check-resources":
			handlers.emit("check-resources");
			break;
		case "keyboard-shortcuts":
			handlers.emit("open-settings", "keyboard");
			break;
		case "quit":
			handlers.quit();
			break;
		case "quit-completely":
			handlers.quitCompletely();
			break;
	}
}
