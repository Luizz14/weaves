import { z } from "zod";

export const desktopRpcMessageSchema = z.discriminatedUnion("method", [
	z
		.object({
			method: z.literal("request"),
			operation: z
				.object({
					id: z.string().min(1).max(128),
					type: z.enum(["query", "mutation", "subscription"]),
					path: z.string().min(1).max(512),
					input: z.unknown(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({ method: z.literal("stop"), id: z.string().min(1).max(128) })
		.strict(),
]);

export type DesktopRpcMessage = z.infer<typeof desktopRpcMessageSchema>;
export const DESKTOP_NATIVE_EVENT = "desktop:event";
export const DESKTOP_RPC_RESPONSE = "trpc:response";

export type DesktopNativeEvent = {
	name: string;
	payload: unknown;
};
