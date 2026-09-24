import { afterEach, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
	MAX_NATIVE_FRAME_BYTES,
	type NativeRequest,
	StdioPeer,
} from "./stdio-peer";

const peers: StdioPeer[] = [];
afterEach(() => {
	for (const peer of peers.splice(0)) peer.close();
});

function pair(handler: (request: NativeRequest) => Promise<unknown>) {
	const toNative = new PassThrough();
	const toHost = new PassThrough();
	const host = new StdioPeer(toHost, toNative, async () => null);
	const native = new StdioPeer(toNative, toHost, handler);
	peers.push(host, native);
	return { host, native, toHost };
}

test("correlates concurrent replies arriving out of order", async () => {
	let finishSlow: ((value: unknown) => void) | undefined;
	const { host } = pair(async ({ method }) =>
		method === "slow"
			? new Promise((resolve) => {
					finishSlow = resolve;
				})
			: "fast",
	);
	const slow = host.request("slow", null);
	expect(await host.request("fast", null)).toBe("fast");
	finishSlow?.("slow");
	expect(await slow).toBe("slow");
});

test("delivers errors and removes event listeners", async () => {
	const { host, native } = pair(async () => {
		throw new Error("expected failure");
	});
	await expect(host.request("failure", {})).rejects.toThrow("expected failure");
	const received: unknown[] = [];
	const unsubscribe = host.subscribe((event) => received.push(event.payload));
	native.emit("changed", { value: 1 }, "window-1");
	unsubscribe();
	native.emit("changed", { value: 2 }, "window-1");
	expect(received).toEqual([{ value: 1 }]);
});

test("rejects pending work when the peer exits", async () => {
	const { host, toHost } = pair(async () => new Promise(() => {}));
	const pending = host.request("pending", null);
	const rejected = pending.catch((error: unknown) => error);
	toHost.end();
	expect(await rejected).toMatchObject({ message: "Native transport closed" });
	await expect(host.request("later", null)).rejects.toThrow("closed");
});

test("fails closed on invalid frames without reflecting their contents", async () => {
	const { host, toHost } = pair(async () => new Promise(() => {}));
	const pending = host.request("pending", null);
	const rejected = pending.catch((error: unknown) => error);
	toHost.write("secret-value-not-json\n");
	expect(await rejected).toMatchObject({ message: "Invalid native frame" });
});

test("times out requests without confusing later replies", async () => {
	const { host } = pair(async ({ method }) =>
		method === "stuck" ? new Promise(() => {}) : 42,
	);
	await expect(host.request("stuck", null, 5)).rejects.toThrow("timed out");
	expect(await host.request("healthy", null)).toBe(42);
});

test("decodes UTF-8 events split across arbitrary byte boundaries", () => {
	const { host, toHost } = pair(async () => null);
	const received: unknown[] = [];
	host.subscribe((event) => received.push(event.payload));
	const message = Buffer.from(
		`${JSON.stringify({ type: "event", name: "sample", payload: "ação\n🎉" })}\n`,
	);
	for (const byte of message) toHost.write(Buffer.from([byte]));
	expect(received).toEqual(["ação\n🎉"]);
});

test("uses explicit JSON null for payload-free messages", async () => {
	const { host, native } = pair(async ({ params }) => params);
	expect(await host.request("empty", undefined)).toBeNull();
	const received: unknown[] = [];
	host.subscribe((event) => received.push(event.payload));
	native.emit("empty", undefined);
	expect(received).toEqual([null]);
});

test("does not continue processing a frame after an event handler fails", async () => {
	const { host, native } = pair(async () => new Promise(() => {}));
	const pending = host
		.request("pending", null)
		.catch((error: unknown) => error);
	host.subscribe(() => {
		throw new Error("handler bug");
	});
	native.emit("changed", null);
	expect(await pending).toMatchObject({
		message: "Native event handler failed",
	});
	expect(() => host.subscribe(() => {})).toThrow("closed");
});

test("rejects an oversized unterminated frame before parsing it", async () => {
	const { host, toHost } = pair(async () => new Promise(() => {}));
	const pending = host
		.request("pending", null)
		.catch((error: unknown) => error);
	toHost.write(Buffer.alloc(MAX_NATIVE_FRAME_BYTES + 1, 32));
	expect(await pending).toMatchObject({
		message: "Native frame exceeds limit",
	});
});

test("interactive requests may omit a deadline but still fail when the transport closes", async () => {
	const { host, toHost } = pair(async () => new Promise(() => {}));
	const pending = host
		.request("dialog.open", null, null)
		.catch((error: unknown) => error);
	toHost.end();
	expect(await pending).toMatchObject({ message: "Native transport closed" });
});

test("forwards the trusted host window context without putting it into user parameters", async () => {
	const { host } = pair(async ({ windowLabel, params }) => ({
		windowLabel,
		params,
	}));
	expect(
		await host.request(
			"browser.info",
			{ paneId: "pane-1" },
			30_000,
			"window-2",
		),
	).toEqual({ windowLabel: "window-2", params: { paneId: "pane-1" } });
});
