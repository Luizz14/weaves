import type { IpcRenderer } from "electron";

// biome-ignore lint/suspicious/noExplicitAny: Public IPC callbacks accept dynamic channel payloads.
export type IpcListener = (...args: any[]) => void;
export type IpcRendererTransport = {
	invoke: IpcRenderer["invoke"];
	send: IpcRenderer["send"];
	subscribe: (channel: string, listener: IpcListener) => number;
	unsubscribe: (channel: string, id: number) => void;
};

export function installIpcRendererApi(
	transport: IpcRendererTransport,
	target: object = window,
) {
	const registrations = new WeakMap<IpcListener, Map<string, number[]>>();
	const api = {
		invoke: transport.invoke,
		send: transport.send,
		on(channel: string, listener: IpcListener) {
			if (typeof listener !== "function")
				throw new TypeError("IPC listener must be a function");
			const id = transport.subscribe(channel, listener);
			const channels =
				registrations.get(listener) ?? new Map<string, number[]>();
			const ids = channels.get(channel) ?? [];
			ids.push(id);
			channels.set(channel, ids);
			registrations.set(listener, channels);
		},
		off(channel: string, listener: IpcListener) {
			const channels = registrations.get(listener);
			const ids = channels?.get(channel);
			const id = ids?.pop();
			if (id !== undefined) transport.unsubscribe(channel, id);
			if (ids?.length === 0) channels?.delete(channel);
			if (channels?.size === 0) registrations.delete(listener);
		},
	};
	Object.defineProperty(target, "ipcRenderer", {
		value: Object.freeze(api),
		writable: false,
		configurable: false,
		enumerable: true,
	});
	return api;
}
