import { afterEach, expect, test } from "bun:test";
import { createTRPCProxyClient } from "@trpc/client";
import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { sessionIdLink } from "renderer/lib/session-id-link";
import { tauriTrpcLink } from "renderer/lib/tauri-trpc-link";
import type { DesktopRpcMessage } from "shared/native-rpc";
import superjson from "superjson";
import { z } from "zod";
import { RpcDispatcher } from "./rpc-dispatcher";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
	const stopped: string[] = [];
	const emitters = new Map<string, () => void>();
	const t = initTRPC
		.context<{ windowLabel: string }>()
		.create({ transformer: superjson });
	const router = t.router({
		echo: t.procedure.input(z.date()).query(({ input, ctx }) => ({
			date: input,
			window: ctx.windowLabel,
			count: 42n,
		})),
		fail: t.procedure.query(() => {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Missing roundtrip fixture",
			});
		}),
		stream: t.procedure.subscription(({ ctx }) =>
			observable<string>((observer) => {
				emitters.set(ctx.windowLabel, () => observer.next(ctx.windowLabel));
				return () => {
					stopped.push(ctx.windowLabel);
					emitters.delete(ctx.windowLabel);
				};
			}),
		),
	});
	const listeners = new Map<string, Set<(response: unknown) => void>>();
	const disconnectListeners = new Set<(error: Error) => void>();
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(windowLabel, response) => {
			for (const listener of listeners.get(windowLabel) ?? [])
				listener(response);
		},
	);
	cleanup.push(() => dispatcher.dispose());
	function client(
		windowLabel: string,
		afterRegistration: (
			message: DesktopRpcMessage,
		) => Promise<void> = async () => {},
	) {
		return createTRPCProxyClient<typeof router>({
			links: [
				sessionIdLink(),
				() =>
					({ op, next }) =>
						next({ ...op, id: 1 }),
				tauriTrpcLink({
					transformer: superjson,
					transport: {
						subscribeDisconnect: (listener) => {
							disconnectListeners.add(listener);
							return () => {
								disconnectListeners.delete(listener);
							};
						},
						send: async (message) => {
							dispatcher.handle(windowLabel, message);
							await afterRegistration(message);
						},
						subscribe: (listener) => {
							let set = listeners.get(windowLabel);
							if (!set) {
								set = new Set();
								listeners.set(windowLabel, set);
							}
							set.add(listener);
							return () => {
								set.delete(listener);
							};
						},
					},
				}),
			],
		});
	}
	return { client, emitters, stopped, listeners, disconnectListeners };
}

test("real renderer link and host dispatcher preserve values across concurrent windows", async () => {
	const { client, listeners } = fixture();
	const date = new Date("2026-09-21T00:00:00Z");
	const [a, b] = await Promise.all([
		client("a").echo.query(date),
		client("b").echo.query(date),
	]);
	expect(a).toEqual({ date, window: "a", count: 42n });
	expect(b).toEqual({ date, window: "b", count: 42n });
	expect(listeners.get("a")?.size).toBe(0);
	expect(listeners.get("b")?.size).toBe(0);
});

test("real renderer receives the original structured tRPC error", async () => {
	const { client } = fixture();
	const error = await client("a")
		.fail.query()
		.catch((reason: unknown) => reason);
	expect(error).toMatchObject({
		message: "Missing roundtrip fixture",
		data: { code: "NOT_FOUND", path: "fail" },
	});
});

test("cancellation waits for registration acknowledgment and releases host subscription", async () => {
	const { client, stopped, listeners } = fixture();
	const messages: DesktopRpcMessage[] = [];
	let acknowledge: (() => void) | undefined;
	const api = client("a", async (message) => {
		messages.push(message);
		if (message.method === "request")
			await new Promise<void>((resolve) => {
				acknowledge = resolve;
			});
	});
	const subscription = api.stream.subscribe(undefined, {});
	await tick();
	subscription.unsubscribe();
	expect(messages.map((message) => message.method)).toEqual(["request"]);
	acknowledge?.();
	await tick();
	expect(messages.map((message) => message.method)).toEqual([
		"request",
		"stop",
	]);
	expect(stopped).toEqual(["a"]);
	expect(listeners.get("a")?.size).toBe(0);
});

test("multiple client generations in one window never share wire operation ids", async () => {
	const { client } = fixture();
	const first = new Date("2026-09-21T00:00:00Z");
	const second = new Date("2026-09-22T00:00:00Z");
	const results = await Promise.all([
		client("a").echo.query(first),
		client("a").echo.query(second),
	]);
	expect(results.map((result) => result.date)).toEqual([first, second]);
});

test("completed queries and errors release disconnect listeners", async () => {
	const { client, disconnectListeners } = fixture();
	const api = client("a");
	await api.echo.query(new Date());
	expect(disconnectListeners.size).toBe(0);
	await api.fail.query().catch(() => {});
	expect(disconnectListeners.size).toBe(0);
});
