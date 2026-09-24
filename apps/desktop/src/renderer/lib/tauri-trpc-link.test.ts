import { afterEach, expect, mock, test } from "bun:test";
import { createTRPCProxyClient } from "@trpc/client";
import { initTRPC, TRPCError, transformTRPCResponse } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { z } from "zod";

const invokeCalls: Array<{ command: string; args: unknown }> = [];
const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
let resolveDesktopRpc: (() => void) | undefined;
const bootstrapPayload = {
	schemaVersion: 1,
	appName: "Superset",
	appVersion: "1.29.0",
	isPackaged: false,
	paths: {
		appPath: "/tmp/superset/app",
		resourcePath: "/tmp/superset/resources",
		userDataPath: "/tmp/superset/user-data",
		sessionDataPath: "/tmp/superset/session-data",
		downloads: "/tmp/superset/downloads",
	},
	platform: "darwin",
	arch: "arm64",
	preferredLanguages: ["en-US"],
	runtime: "tauri",
};

mock.module("@tauri-apps/api/core", () => ({
	invoke: mock((command: string, args: unknown) => {
		invokeCalls.push({ command, args });
		if (
			command === "native_command" &&
			(args as { method?: string }).method === "app.bootstrap"
		) {
			return Promise.resolve(bootstrapPayload);
		}
		if (command === "desktop_rpc") {
			return new Promise<void>((resolve) => {
				resolveDesktopRpc = resolve;
			});
		}
		return Promise.resolve(null);
	}),
}));
mock.module("@tauri-apps/api/event", () => ({
	listen: mock(
		async (name: string, handler: (event: { payload: unknown }) => void) => {
			eventHandlers.set(name, handler);
			return () => {
				eventHandlers.delete(name);
			};
		},
	),
}));
mock.module("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({
		onDragDropEvent: async () => () => {},
	}),
}));

(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

const t = initTRPC.create({ transformer: superjson });
const router = t.router({
	echo: t.procedure.input(z.date()).query(({ input }) => input),
	fail: t.procedure.query(() => {
		throw new TRPCError({ code: "NOT_FOUND", message: "Missing fixture" });
	}),
	stream: t.procedure.subscription(() => observable<string>(() => () => {})),
});

function emitDesktopEvent(name: string, payload: unknown): void {
	eventHandlers.get("desktop:event")?.({ payload: { name, payload } });
}

function emitBootstrap(): void {
	emitDesktopEvent("bootstrap", bootstrapPayload);
}

async function tick(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(async () => {
	invokeCalls.length = 0;
	eventHandlers.clear();
	resolveDesktopRpc = undefined;
	const { disposeDesktopBridge } = await import("./native-bridge");
	await disposeDesktopBridge();
	(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

test("registers the listener before sending serialized tRPC input", async () => {
	const { sessionIdLink } = await import("./session-id-link");
	const { tauriTrpcLink } = await import("./tauri-trpc-link");
	const client = createTRPCProxyClient<typeof router>({
		links: [sessionIdLink(), tauriTrpcLink({ transformer: superjson })],
	});
	const date = new Date("2026-09-21T00:00:00.000Z");
	const resultPromise = client.echo.query(date);

	await tick();
	const listener = eventHandlers.get("desktop:event");
	expect(listener).toBeDefined();
	emitBootstrap();
	await tick();

	const request = invokeCalls.find(({ command }) => command === "desktop_rpc");
	expect(request).toBeDefined();
	const args = request?.args as {
		message: {
			operation: { id: string; input: unknown };
		};
	};
	expect(args.message.operation.input).toEqual(superjson.serialize(date));
	const response = transformTRPCResponse(router._def._config, {
		id: args.message.operation.id,
		result: { type: "data", data: date },
	});
	emitDesktopEvent("trpc:response", response);
	resolveDesktopRpc?.();

	expect(await resultPromise).toEqual(date);
});

test("orders cancellation after the desktop_rpc acknowledgement", async () => {
	const { sessionIdLink } = await import("./session-id-link");
	const { tauriTrpcLink } = await import("./tauri-trpc-link");
	const client = createTRPCProxyClient<typeof router>({
		links: [sessionIdLink(), tauriTrpcLink({ transformer: superjson })],
	});
	const subscription = client.stream.subscribe(undefined, {});
	await tick();
	emitBootstrap();
	await tick();

	subscription.unsubscribe();
	expect(
		invokeCalls.filter(({ command }) => command === "desktop_rpc"),
	).toHaveLength(1);
	resolveDesktopRpc?.();
	await tick();

	const desktopCalls = invokeCalls.filter(
		({ command }) => command === "desktop_rpc",
	);
	expect(desktopCalls).toHaveLength(2);
	expect(
		(desktopCalls[1]?.args as { message: { method: string } }).message.method,
	).toBe("stop");
});

test("preserves structured tRPC errors", async () => {
	const { sessionIdLink } = await import("./session-id-link");
	const { tauriTrpcLink } = await import("./tauri-trpc-link");
	const client = createTRPCProxyClient<typeof router>({
		links: [sessionIdLink(), tauriTrpcLink({ transformer: superjson })],
	});
	const resultPromise = client.fail.query();
	await tick();
	emitBootstrap();
	await tick();

	const request = invokeCalls.find(({ command }) => command === "desktop_rpc");
	expect(request).toBeDefined();
	const args = request?.args as { message: { operation: { id: string } } };
	const response = transformTRPCResponse(router._def._config, {
		id: args.message.operation.id,
		error: {
			code: -32004,
			message: "Missing fixture",
			data: { code: "NOT_FOUND", httpStatus: 404, path: "fail" },
		},
	});
	emitDesktopEvent("trpc:response", response);
	resolveDesktopRpc?.();

	await expect(resultPromise).rejects.toMatchObject({
		message: "Missing fixture",
		data: { code: "NOT_FOUND", httpStatus: 404, path: "fail" },
	});
});

test("rejects pending work when the desktop service disconnects after ACK", async () => {
	const { sessionIdLink } = await import("./session-id-link");
	const { tauriTrpcLink } = await import("./tauri-trpc-link");
	const client = createTRPCProxyClient<typeof router>({
		links: [sessionIdLink(), tauriTrpcLink({ transformer: superjson })],
	});
	const resultPromise = client.echo.query(new Date());
	await tick();
	emitBootstrap();
	await tick();
	resolveDesktopRpc?.();
	await tick();
	emitDesktopEvent("native:disconnected", {
		reason: "Node service exited",
	});

	await expect(resultPromise).rejects.toThrow("Node service exited");
});
