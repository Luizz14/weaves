import type { NodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import type { LspSessions } from "./sessions";

export function registerLspRoutes(
	app: Hono,
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"],
	sessions: LspSessions,
) {
	app.get(
		"/lsp/:sessionId",
		async (context, next) => {
			if (!sessions.has(context.req.param("sessionId")))
				return context.json({ error: "Session not found" }, 404);
			return next();
		},
		upgradeWebSocket((context) => {
			const sessionId = context.req.param("sessionId") ?? "";
			let attached = false;
			return {
				onOpen(_event, socket) {
					attached = sessions.attach(sessionId, socket);
				},
				onMessage(event, socket) {
					if (!attached) return;
					if (typeof event.data !== "string") {
						socket.close(1003, "Text messages required");
						return;
					}
					void sessions.receive(sessionId, event.data).catch((error) => {
						console.error("[lsp] Client message failed", error);
						socket.close(1008, "Invalid LSP message");
						void sessions.stop(sessionId);
					});
				},
				onClose() {
					if (attached) void sessions.stop(sessionId);
				},
				onError() {
					if (attached) void sessions.stop(sessionId);
				},
			};
		}),
	);
}
