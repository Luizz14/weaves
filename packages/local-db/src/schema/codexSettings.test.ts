/// <reference types="bun-types" />
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_CODEX_CHAT_SETTINGS } from "@superset/shared/codex-chat-settings";

test("generated migration preserves settings and persists Codex preferences", () => {
	const sqlite = new Database(":memory:");
	try {
		sqlite.exec(
			"CREATE TABLE settings (id INTEGER PRIMARY KEY, last_active_workspace_id TEXT); INSERT INTO settings VALUES (1, 'existing-workspace');",
		);
		sqlite.exec(
			readFileSync(
				new URL("../../drizzle/0057_codex_chat_settings.sql", import.meta.url),
				"utf8",
			),
		);
		expect(
			sqlite
				.query("SELECT last_active_workspace_id, codex_chat FROM settings")
				.get(),
		).toEqual({
			last_active_workspace_id: "existing-workspace",
			codex_chat: null,
		});
		sqlite
			.query("UPDATE settings SET codex_chat = ? WHERE id = 1")
			.run(JSON.stringify(DEFAULT_CODEX_CHAT_SETTINGS));
		const row = sqlite
			.query<{ codex_chat: string }, []>("SELECT codex_chat FROM settings")
			.get();
		expect(JSON.parse(row?.codex_chat ?? "null")).toEqual(
			DEFAULT_CODEX_CHAT_SETTINGS,
		);
	} finally {
		sqlite.close();
	}
});
