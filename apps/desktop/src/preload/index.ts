import "@sentry/electron/preload";

import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
	type RendererStartupMarker,
	STARTUP_DIAGNOSTICS_ARGUMENT,
	STARTUP_DIAGNOSTICS_CHANNEL,
} from "shared/startup-diagnostics";
import { exposeElectronTRPC } from "trpc-electron/main";

import {
	type IpcRendererTransport,
	installIpcRendererApi,
} from "./ipc-listeners";

declare const __APP_VERSION__: string;

declare global {
	interface Window {
		App: typeof API;
		ipcRenderer: ReturnType<typeof installIpcRendererApi>;
		webUtils: {
			getPathForFile: (file: File) => string;
		};
	}
}

const API = {
	sayHelloFromBridge: () => console.log("\nHello from bridgeAPI! 👋\n\n"),
	username: process.env.USER,
	appVersion: __APP_VERSION__,
	platform: process.platform,
	startupDiagnostics: process.argv.includes(STARTUP_DIAGNOSTICS_ARGUMENT)
		? (marker: RendererStartupMarker) =>
				ipcRenderer.send(STARTUP_DIAGNOSTICS_CHANNEL, marker)
		: undefined,
};

let nextSubscriptionId = 0;
const subscriptions = new Map<
	number,
	{ channel: string; listener: (event: unknown, ...args: unknown[]) => void }
>();
const ipcTransport: IpcRendererTransport = {
	invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
	send: (channel, ...args) => ipcRenderer.send(channel, ...args),
	subscribe(channel, listener) {
		const id = ++nextSubscriptionId;
		const wrapped = (_event: unknown, ...args: unknown[]) => {
			listener(...args);
		};
		ipcRenderer.on(channel, wrapped);
		subscriptions.set(id, { channel, listener: wrapped });
		return id;
	},
	unsubscribe(channel, id) {
		const subscription = subscriptions.get(id);
		if (subscription?.channel !== channel) return;
		ipcRenderer.removeListener(channel, subscription.listener);
		subscriptions.delete(id);
	},
};

// Expose electron-trpc IPC channel FIRST (must be before contextBridge calls)
exposeElectronTRPC();

contextBridge.exposeInMainWorld("App", API);
contextBridge.executeInMainWorld({
	func: installIpcRendererApi,
	args: [ipcTransport],
});
contextBridge.exposeInMainWorld("webUtils", {
	getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
