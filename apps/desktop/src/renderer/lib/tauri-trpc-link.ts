import { type Operation, TRPCClientError, type TRPCLink } from "@trpc/client";
import {
	getTransformer,
	type TransformerOptions,
} from "@trpc/client/unstable-internals";
import type { AnyRouter, inferTRPCClientTypes } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import type { TRPCResponseMessage } from "@trpc/server/rpc";
import {
	type TRPCErrorResponse,
	transformResult,
} from "@trpc/server/unstable-core-do-not-import";
import {
	DESKTOP_RPC_RESPONSE,
	type DesktopRpcMessage,
} from "shared/native-rpc";
import {
	DESKTOP_SERVICE_DISCONNECTED,
	DESKTOP_SERVICE_DISCONNECTED_LEGACY,
	desktopRpc,
	subscribeDesktopEvent,
} from "./native-bridge";

export type TauriTrpcTransport = {
	send: (message: DesktopRpcMessage) => Promise<void>;
	subscribe: (listener: (payload: unknown) => void) => () => void;
	subscribeDisconnect?: (listener: (error: Error) => void) => () => void;
};

export type TauriLinkOptions<TRouter extends AnyRouter> = TransformerOptions<
	inferTRPCClientTypes<TRouter>
> & {
	transport?: TauriTrpcTransport;
};

type ResponseWithId = TRPCResponseMessage & {
	id?: string | number;
};

function responseId(response: unknown): string | number | undefined {
	if (typeof response !== "object" || response === null) return undefined;
	const id = (response as { id?: unknown }).id;
	return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTRPCErrorResponse(error: unknown): error is TRPCErrorResponse {
	if (!isRecord(error) || !isRecord(error.error)) return false;
	return (
		typeof error.error.code === "number" &&
		typeof error.error.message === "string"
	);
}

function toClientError(error: unknown): TRPCClientError<AnyRouter> {
	if (isTRPCErrorResponse(error)) return TRPCClientError.from(error);
	if (error instanceof Error) return TRPCClientError.from(error);
	return TRPCClientError.from(new Error(String(error)));
}

function toRpcMessage(
	op: Operation,
	id: string,
	serializeInput: (input: unknown) => unknown,
): DesktopRpcMessage {
	return {
		method: "request",
		operation: {
			id,
			type: op.type,
			path: op.path,
			input: serializeInput(op.input),
		},
	};
}

export function tauriTrpcLink<TRouter extends AnyRouter>(
	opts?: TauriLinkOptions<TRouter>,
): TRPCLink<TRouter> {
	return () => {
		const transformer = getTransformer(opts?.transformer);
		const transport: TauriTrpcTransport = opts?.transport ?? {
			send: async (message) => {
				await desktopRpc(message);
			},
			subscribe: (listener) =>
				subscribeDesktopEvent(DESKTOP_RPC_RESPONSE, listener),
			subscribeDisconnect: (listener) => {
				const onDisconnect = (payload: unknown) =>
					listener(
						new Error(
							isRecord(payload) && typeof payload.reason === "string"
								? payload.reason
								: "Desktop service disconnected",
						),
					);
				const unsubscribeNative = subscribeDesktopEvent(
					DESKTOP_SERVICE_DISCONNECTED,
					onDisconnect,
				);
				const unsubscribeLegacy = subscribeDesktopEvent(
					DESKTOP_SERVICE_DISCONNECTED_LEGACY,
					onDisconnect,
				);
				return () => {
					unsubscribeNative();
					unsubscribeLegacy();
				};
			},
		};

		return ({ op }) =>
			observable((observer) => {
				const operationId = crypto.randomUUID();
				let settled = false;
				let acknowledged = false;
				let canceled = false;
				let unsubscribeFromDisconnect: (() => void) | undefined;

				const unsubscribeFromResponses = transport.subscribe((payload) => {
					if (settled || responseId(payload) !== operationId) return;

					try {
						const transformed = transformResult(
							payload as ResponseWithId,
							transformer.output,
						);
						if (!transformed.ok) {
							settled = true;
							observer.error(toClientError(transformed.error));
							unsubscribeFromResponses();
							return;
						}

						observer.next({ result: transformed.result });
						if (
							op.type !== "subscription" ||
							transformed.result.type === "stopped"
						) {
							settled = true;
							observer.complete();
							unsubscribeFromResponses();
						}
					} catch (error) {
						settled = true;
						unsubscribeFromResponses();
						observer.error(toClientError(error));
					}
				});
				unsubscribeFromDisconnect = transport.subscribeDisconnect?.((error) => {
					if (settled) return;
					settled = true;
					unsubscribeFromResponses();
					unsubscribeFromDisconnect?.();
					observer.error(toClientError(error));
				});

				const rpcMessage = toRpcMessage(op, operationId, (input) =>
					transformer.input.serialize(input),
				);
				void transport
					.send(rpcMessage)
					.then(() => {
						acknowledged = true;
						if (canceled) {
							void transport
								.send({ method: "stop", id: operationId })
								.catch(() => {});
						}
					})
					.catch((error: unknown) => {
						if (settled || canceled) return;
						settled = true;
						unsubscribeFromResponses();
						unsubscribeFromDisconnect?.();
						observer.error(toClientError(error));
					});

				return () => {
					unsubscribeFromResponses();
					unsubscribeFromDisconnect?.();
					if (settled) return;
					canceled = true;
					if (acknowledged) {
						void transport
							.send({ method: "stop", id: operationId })
							.catch(() => {});
					}
				};
			});
	};
}
