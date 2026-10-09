import type { Hono } from "hono";
import { z } from "zod";
import { verifyIdeContextToken } from "./auth";
import type { IdeContextStore } from "./store";

const inputSchema = z.strictObject({ terminalId: z.string().min(1).max(128) });

export interface IdeContextTerminal {
	workspaceId: string;
	workspacePath: string;
	live: boolean;
}

export function registerIdeContextRoutes(options: {
	app: Hono;
	organizationId: string;
	store: IdeContextStore;
	resolveTerminal: (terminalId: string) => IdeContextTerminal | null;
}): void {
	options.app.post("/ide-context/terminal", async (c) => {
		c.header("Cache-Control", "no-store");
		if (c.req.header("origin")) return c.json({ error: "Unauthorized" }, 401);
		const contentLength = Number(c.req.header("content-length") ?? 0);
		if (contentLength > 512) return c.json({ error: "Invalid request" }, 400);
		const reader = c.req.raw.body?.getReader();
		if (!reader) return c.json({ error: "Invalid request" }, 400);
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > 512) {
				await reader.cancel();
				return c.json({ error: "Invalid request" }, 400);
			}
			chunks.push(chunk.value);
		}
		const text = Buffer.concat(chunks).toString("utf8");
		let input: z.infer<typeof inputSchema>;
		try {
			input = inputSchema.parse(JSON.parse(text));
		} catch {
			return c.json({ error: "Invalid request" }, 400);
		}
		const terminal = options.resolveTerminal(input.terminalId);
		const authorization = c.req.header("authorization") ?? "";
		const token = authorization.startsWith("Bearer ")
			? authorization.slice(7)
			: "";
		if (
			!terminal?.live ||
			!verifyIdeContextToken(
				options.organizationId,
				terminal.workspaceId,
				input.terminalId,
				token,
			)
		) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return c.json({
			workspacePath: terminal.workspacePath,
			snapshot: options.store.read(terminal.workspaceId),
		});
	});
}
