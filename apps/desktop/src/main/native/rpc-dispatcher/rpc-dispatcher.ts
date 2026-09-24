import {
	type AnyTRPCRouter,
	callTRPCProcedure,
	getErrorShape,
	getTRPCErrorFromUnknown,
	type inferRouterContext,
	TRPCError,
	transformTRPCResponse,
} from "@trpc/server";
import {
	isObservable,
	observableToAsyncIterable,
} from "@trpc/server/observable";
import type { TRPCResponseMessage } from "@trpc/server/rpc";
import {
	type DesktopRpcMessage,
	desktopRpcMessageSchema,
} from "shared/native-rpc";

type RpcOperation = Extract<
	DesktopRpcMessage,
	{ method: "request" }
>["operation"];
type ActiveCall = { abort: AbortController };

export class RpcDispatcher<Router extends AnyTRPCRouter> {
	private readonly calls = new Map<string, Map<string, ActiveCall>>();

	constructor(
		private readonly router: Router,
		private readonly createContext: (
			windowLabel: string,
		) => Promise<inferRouterContext<Router>>,
		private readonly respond: (
			windowLabel: string,
			response: TRPCResponseMessage,
		) => void,
		private readonly onDeliveryError: (error: unknown) => void = () => {},
	) {}

	handle(windowLabel: string, input: unknown): void {
		const message = desktopRpcMessageSchema.parse(input);
		let calls = this.calls.get(windowLabel);
		if (message.method === "stop") {
			calls?.get(message.id)?.abort.abort();
			return;
		}
		if (!calls) {
			calls = new Map();
			this.calls.set(windowLabel, calls);
		}
		if (calls.has(message.operation.id))
			throw new Error("Duplicate desktop RPC operation");
		if (calls.size >= 256)
			throw new Error("Desktop RPC operation queue is full");
		const call = { abort: new AbortController() };
		calls.set(message.operation.id, call);
		void this.execute(windowLabel, message.operation, call);
	}

	disposeWindow(windowLabel: string): void {
		const calls = this.calls.get(windowLabel);
		this.calls.delete(windowLabel);
		for (const call of calls?.values() ?? []) call.abort.abort();
	}

	dispose(): void {
		for (const windowLabel of this.calls.keys())
			this.disposeWindow(windowLabel);
	}

	private async execute(
		windowLabel: string,
		operation: RpcOperation,
		call: ActiveCall,
	): Promise<void> {
		let context: inferRouterContext<Router> | undefined;
		let input: unknown;
		const send = (response: TRPCResponseMessage) => {
			if (
				!call.abort.signal.aborted &&
				this.calls.get(windowLabel)?.get(operation.id) === call
			) {
				try {
					const transformed = transformTRPCResponse(
						this.router._def._config,
						response,
					);
					if (Array.isArray(transformed))
						throw new Error("Unexpected RPC response batch");
					this.respond(windowLabel, { ...transformed, id: response.id });
				} catch (error) {
					this.disposeWindow(windowLabel);
					this.onDeliveryError(error);
				}
			}
		};
		try {
			context = await this.createContext(windowLabel);
			if (call.abort.signal.aborted) return;
			input = this.router._def._config.transformer.input.deserialize(
				operation.input,
			);
			const result: unknown = await callTRPCProcedure({
				ctx: context,
				path: operation.path,
				router: this.router,
				getRawInput: async () => input,
				type: operation.type,
				signal: call.abort.signal,
				batchIndex: 0,
			});
			if (call.abort.signal.aborted) return;
			if (operation.type !== "subscription") {
				if (isObservable(result) || isAsyncIterable(result))
					throw new TRPCError({
						code: "UNSUPPORTED_MEDIA_TYPE",
						message: "Streaming result requires a subscription",
					});
				send({ id: operation.id, result: { type: "data", data: result } });
				return;
			}
			const iterable = isObservable(result)
				? observableToAsyncIterable(result, call.abort.signal)
				: result;
			if (!isAsyncIterable(iterable))
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Subscription did not return a stream",
				});
			send({ id: operation.id, result: { type: "started" } });
			const iterator = iterable[Symbol.asyncIterator]();
			try {
				while (!call.abort.signal.aborted) {
					const next = await nextUntilAbort(iterator, call.abort.signal);
					if (!next || next.done) break;
					send({
						id: operation.id,
						result: { type: "data", data: next.value },
					});
				}
			} finally {
				void iterator.return?.().catch(() => {});
			}
			send({ id: operation.id, result: { type: "stopped" } });
		} catch (cause) {
			send({
				id: operation.id,
				error: getErrorShape({
					config: this.router._def._config,
					error: getTRPCErrorFromUnknown(cause),
					type: operation.type,
					path: operation.path,
					input,
					ctx: context,
				}),
			});
		} finally {
			const calls = this.calls.get(windowLabel);
			if (calls?.get(operation.id) === call) calls.delete(operation.id);
			if (calls?.size === 0) this.calls.delete(windowLabel);
		}
	}
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		Symbol.asyncIterator in value &&
		typeof value[Symbol.asyncIterator] === "function"
	);
}

function nextUntilAbort(
	iterator: AsyncIterator<unknown>,
	signal: AbortSignal,
): Promise<IteratorResult<unknown> | null> {
	if (signal.aborted) return Promise.resolve(null);
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			resolve(null);
		};
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve()
			.then(() => iterator.next())
			.then(
				(result) => {
					signal.removeEventListener("abort", abort);
					resolve(result);
				},
				(error) => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			);
	});
}
