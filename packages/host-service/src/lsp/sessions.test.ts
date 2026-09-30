import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { filePathToLspUri, lspSettingsSchema } from "@superset/shared/lsp";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { WorkspaceFilesystemManager } from "../runtime/filesystem";
import { initTerminalBaseEnv } from "../terminal/env";
import { getConfigurationSection, LspSessions } from "./sessions";
import { readLspSettings, writeLspSettings } from "./settings";

test("configuration sections preserve schema associations", () => {
	expect(
		getConfigurationSection(
			{ yaml: { schemas: { "./schema.json": "*.yaml" } } },
			"yaml.schemas",
		),
	).toEqual({ "./schema.json": "*.yaml" });
	expect(getConfigurationSection({}, "dart")).toBeNull();
});

test("migrations, stdio framing, initialization, diagnostics and shutdown work together", async () => {
	const root = await mkdtemp(join(tmpdir(), "superset-lsp-session-"));
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });
	const hostDb = db as unknown as HostDb;
	db.insert(schema.projects).values({ id: "project", repoPath: root }).run();
	db.insert(schema.workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			name: "test",
			branch: "main",
			worktreePath: root,
		})
		.run();
	const filesystem = new WorkspaceFilesystemManager({ db: hostDb });
	const sessions = new LspSessions({ db: hostDb, filesystem });
	try {
		await mkdir(join(root, "src"));
		initTerminalBaseEnv({ PATH: process.env.PATH ?? "" });
		expect(readLspSettings(hostDb).servers.typescript.enabled).toBe(true);
		const settings = lspSettingsSchema.parse({});
		settings.servers.typescript = {
			...settings.servers.typescript,
			command: process.execPath,
			arguments: [resolve(import.meta.dir, "fixtures/server.cts")],
			configuration: { yaml: { schemas: { "./schema.json": "*.yaml" } } },
		};
		writeLspSettings(hostDb, settings);
		const session = await sessions.resolve("workspace", join(root, "src/a.ts"));
		expect(session?.state).toBe("starting");
		if (!session?.sessionId) throw new Error("Expected session");
		const messages: Record<string, unknown>[] = [];
		sessions.attach(session.sessionId, {
			send(data) {
				messages.push(JSON.parse(data));
			},
			close() {},
		});
		await sessions.receive(
			session.sessionId,
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { rootUri: "file:///wrong", capabilities: {} },
			}),
		);
		await waitFor(() => messages.some((message) => message.id === 1));
		expect(messages.find((message) => message.id === 1)?.result).toMatchObject({
			root: filePathToLspUri(root),
			encoding: ["utf-16"],
		});
		await sessions.receive(
			session.sessionId,
			JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }),
		);
		await sessions.receive(
			session.sessionId,
			JSON.stringify({
				jsonrpc: "2.0",
				method: "textDocument/didOpen",
				params: {
					textDocument: {
						uri: filePathToLspUri(join(root, "src/a.ts")),
						text: "ação 🐟",
						languageId: "typescript",
						version: 1,
					},
				},
			}),
		);
		await waitFor(() =>
			messages.some(
				(message) => message.method === "textDocument/publishDiagnostics",
			),
		);
		await sessions.receive(
			session.sessionId,
			JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "test/configuration",
				params: {},
			}),
		);
		await waitFor(() => messages.some((message) => message.id === 2));
		expect(messages.find((message) => message.id === 2)?.result).toEqual([
			{ "./schema.json": "*.yaml" },
		]);
		expect(sessions.status()[0]?.state).toBe("running");
		await sessions.stop(session.sessionId);
		expect(sessions.status()).toEqual([]);
	} finally {
		await sessions.dispose();
		await filesystem.close();
		sqlite.close();
		await rm(root, { recursive: true, force: true });
	}
}, 15_000);

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for language server");
}
