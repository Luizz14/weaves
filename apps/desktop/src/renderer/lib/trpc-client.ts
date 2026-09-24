import { createTRPCProxyClient } from "@trpc/client";
import type { AppRouter } from "lib/trpc/routers";
import superjson from "superjson";
import { electronTrpc } from "./electron-trpc";
import { sessionIdLink } from "./session-id-link";
import { tauriTrpcLink } from "./tauri-trpc-link";

/** Desktop tRPC React client for React hooks. */
export const electronReactClient = electronTrpc.createClient({
	links: [sessionIdLink(), tauriTrpcLink({ transformer: superjson })],
});

/** Desktop tRPC proxy client for imperative calls from stores/utilities. */
export const electronTrpcClient = createTRPCProxyClient<AppRouter>({
	links: [sessionIdLink(), tauriTrpcLink({ transformer: superjson })],
});
