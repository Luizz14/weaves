import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { type IpcListener, installIpcRendererApi } from "./ipc-listeners";

function setup() {
	const events = new EventEmitter();
	let nextId = 0;
	const registered = new Map<
		number,
		{ channel: string; wrapped: (event: unknown, ...args: unknown[]) => void }
	>();
	const api = installIpcRendererApi(
		{
			invoke: async () => undefined,
			send() {},
			subscribe(channel, listener: IpcListener) {
				const id = ++nextId;
				const wrapped = (_event: unknown, ...args: unknown[]) => {
					listener(...args);
				};
				events.on(channel, wrapped);
				registered.set(id, { channel, wrapped });
				return id;
			},
			unsubscribe(channel, id) {
				const entry = registered.get(id);
				if (entry?.channel !== channel) return;
				events.removeListener(channel, entry.wrapped);
				registered.delete(id);
			},
		},
		{},
	);
	return { events, ...api };
}

test("removing a callback from one channel leaves its other channel subscribed", () => {
	const bridge = setup();
	const received: unknown[][] = [];
	const listener = (...args: unknown[]) => {
		received.push(args);
	};
	bridge.on("a", listener);
	bridge.on("b", listener);
	bridge.off("a", listener);
	bridge.events.emit("a", { sender: "native" }, "ignored");
	bridge.events.emit("b", { sender: "native" }, "payload", 42);
	expect(received).toEqual([["payload", 42]]);
	bridge.off("b", listener);
	expect(bridge.events.listenerCount("a")).toBe(0);
	expect(bridge.events.listenerCount("b")).toBe(0);
});

test("duplicate registrations are removed one at a time like EventEmitter", () => {
	const bridge = setup();
	let calls = 0;
	const listener = () => {
		calls++;
	};
	bridge.on("a", listener);
	bridge.on("a", listener);
	bridge.events.emit("a", {});
	expect(calls).toBe(2);
	bridge.off("a", listener);
	bridge.events.emit("a", {});
	expect(calls).toBe(3);
	bridge.off("a", listener);
	bridge.events.emit("a", {});
	expect(calls).toBe(3);
	expect(bridge.events.listenerCount("a")).toBe(0);
});

test("unknown removals do not corrupt an active registration and remounts leave no handlers", () => {
	const bridge = setup();
	const listener = () => {};
	for (let i = 0; i < 50; i++) {
		bridge.on("a", listener);
		bridge.on("b", listener);
		bridge.off("unknown", listener);
		bridge.off("a", () => {});
		expect(bridge.events.listenerCount("a")).toBe(1);
		bridge.off("a", listener);
		bridge.off("b", listener);
		expect(bridge.events.eventNames()).toEqual([]);
	}
});
