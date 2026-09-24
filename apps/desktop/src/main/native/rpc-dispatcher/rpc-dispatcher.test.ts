import { afterEach, expect, test } from "bun:test";
import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import type { TRPCResponseMessage } from "@trpc/server/rpc";
import { transformResult } from "@trpc/server/unstable-core-do-not-import";
import superjson from "superjson";
import { z } from "zod";
import { RpcDispatcher } from "./rpc-dispatcher";

const t = initTRPC
	.context<{ windowLabel: string }>()
	.create({ transformer: superjson });
const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const request = (
	id: string,
	path: string,
	type: "query" | "mutation" | "subscription" = "query",
	input: unknown = undefined,
) => ({
	method: "request",
	operation: { id, path, type, input: superjson.serialize(input) },
});

test("preserves transformed input/output and trusted window context", async () => {
	const router = t.router({
		echo: t.procedure.input(z.date()).query(({ input, ctx }) => ({
			date: input,
			windowLabel: ctx.windowLabel,
			count: 42n,
		})),
	});
	const responses: TRPCResponseMessage[] = [];
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(_, response) => responses.push(response),
	);
	cleanup.push(() => dispatcher.dispose());
	const date = new Date("2026-09-21T00:00:00Z");
	dispatcher.handle("window-1", request("one", "echo", "query", date));
	await tick();
	expect(responses).toHaveLength(1);
	const response = responses[0];
	if (!response) throw new Error("Missing RPC response");
	expect(transformResult(response, superjson)).toMatchObject({
		ok: true,
		result: { data: { date, windowLabel: "window-1", count: 42n } },
	});
});

test("returns structured tRPC errors rather than generic transport failures", async () => {
	const router = t.router({
		fail: t.procedure.query(() => {
			throw new TRPCError({ code: "NOT_FOUND", message: "Missing fixture" });
		}),
	});
	const responses: TRPCResponseMessage[] = [];
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(_, response) => responses.push(response),
	);
	cleanup.push(() => dispatcher.dispose());
	dispatcher.handle("window-1", request("one", "fail"));
	await tick();
	const response = responses[0];
	if (!response) throw new Error("Missing RPC error response");
	expect(transformResult(response, superjson)).toMatchObject({
		ok: false,
		error: {
			error: { message: "Missing fixture", data: { code: "NOT_FOUND" } },
		},
	});
});

test("scopes cancellation and subscription cleanup to the calling window", async () => {
	const unsubscribed: string[] = [];
	const emitters = new Map<string, () => void>();
	const router = t.router({
		changes: t.procedure.subscription(({ ctx }) =>
			observable<string>((emit) => {
				emitters.set(ctx.windowLabel, () => emit.next(ctx.windowLabel));
				return () => {
					unsubscribed.push(ctx.windowLabel);
					emitters.delete(ctx.windowLabel);
				};
			}),
		),
	});
	const responses: { windowLabel: string; response: TRPCResponseMessage }[] =
		[];
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(windowLabel, response) => responses.push({ windowLabel, response }),
	);
	cleanup.push(() => dispatcher.dispose());
	dispatcher.handle("a", request("same-id", "changes", "subscription"));
	dispatcher.handle("b", request("same-id", "changes", "subscription"));
	await tick();
	dispatcher.handle("a", { method: "stop", id: "same-id" });
	await tick();
	expect(unsubscribed).toEqual(["a"]);
	emitters.get("b")?.();
	await tick();
	expect(responses.at(-1)?.windowLabel).toBe("b");
	dispatcher.disposeWindow("b");
	await tick();
	expect(unsubscribed).toEqual(["a", "b"]);
});

test("cancels before an asynchronous context is ready", async () => {
	let contextReady: ((context: { windowLabel: string }) => void) | undefined;
	let invoked = false;
	const router = t.router({
		work: t.procedure.query(() => {
			invoked = true;
			return null;
		}),
	});
	const responses: TRPCResponseMessage[] = [];
	const dispatcher = new RpcDispatcher(
		router,
		() =>
			new Promise((resolve) => {
				contextReady = resolve;
			}),
		(_, response) => responses.push(response),
	);
	cleanup.push(() => dispatcher.dispose());
	dispatcher.handle("a", request("one", "work"));
	dispatcher.handle("a", { method: "stop", id: "one" });
	contextReady?.({ windowLabel: "a" });
	await tick();
	expect(invoked).toBe(false);
	expect(responses).toEqual([]);
});

test("suppresses late replies after a window is disposed", async () => {
	let complete: ((value: string) => void) | undefined;
	const router = t.router({
		work: t.procedure.query(
			() =>
				new Promise<string>((resolve) => {
					complete = resolve;
				}),
		),
	});
	const responses: TRPCResponseMessage[] = [];
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(_, response) => responses.push(response),
	);
	cleanup.push(() => dispatcher.dispose());
	dispatcher.handle("a", request("one", "work"));
	await tick();
	dispatcher.disposeWindow("a");
	complete?.("late");
	await tick();
	expect(responses).toEqual([]);
});

test("a previous window generation cannot deliver into a reused operation id", async () => {
	const completions: ((value: string) => void)[] = [];
	const router = t.router({
		work: t.procedure.query(
			() => new Promise<string>((resolve) => completions.push(resolve)),
		),
	});
	const responses: TRPCResponseMessage[] = [];
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(_, response) => responses.push(response),
	);
	cleanup.push(() => dispatcher.dispose());
	dispatcher.handle("a", request("one", "work"));
	await tick();
	dispatcher.disposeWindow("a");
	dispatcher.handle("a", request("one", "work"));
	await tick();
	completions[0]?.("old");
	await tick();
	expect(responses).toEqual([]);
	completions[1]?.("current");
	await tick();
	expect(responses).toHaveLength(1);
	const response = responses[0];
	if (!response) throw new Error("Missing current window response");
	expect(transformResult(response, superjson)).toMatchObject({
		ok: true,
		result: { data: "current" },
	});
});

test("failed delivery aborts only the affected window subscriptions", async () => {
	const unsubscribed: string[] = [];
	const router = t.router({
		changes: t.procedure.subscription(({ ctx }) =>
			observable<string>(() => () => unsubscribed.push(ctx.windowLabel)),
		),
	});
	const errors: unknown[] = [];
	const deliveryError = new Error("Window transport closed");
	const dispatcher = new RpcDispatcher(
		router,
		async (windowLabel) => ({ windowLabel }),
		(windowLabel) => {
			if (windowLabel === "a") throw deliveryError;
		},
		(error) => errors.push(error),
	);
	cleanup.push(() => dispatcher.dispose());
	dispatcher.handle("a", request("one", "changes", "subscription"));
	dispatcher.handle("b", request("one", "changes", "subscription"));
	await tick();
	expect(errors).toEqual([deliveryError]);
	expect(unsubscribed).toEqual(["a"]);
	dispatcher.disposeWindow("b");
	await tick();
	expect(unsubscribed).toEqual(["a", "b"]);
});
