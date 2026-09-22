/// <reference types="bun-types" />
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("migration adds the Workspaces sidebar preference without changing existing settings", () => {
	const sqlite = new Database(":memory:");
	try {
		sqlite.exec(
			"CREATE TABLE settings (id INTEGER PRIMARY KEY, show_usage_in_sidebar INTEGER); INSERT INTO settings VALUES (1, 1);",
		);
		sqlite.exec(
			readFileSync(
				new URL(
					"../../drizzle/0058_worthless_bloodscream.sql",
					import.meta.url,
				),
				"utf8",
			),
		);

		expect(
			sqlite
				.query(
					"SELECT show_usage_in_sidebar, show_workspaces_in_sidebar FROM settings",
				)
				.get(),
		).toEqual({ show_usage_in_sidebar: 1, show_workspaces_in_sidebar: null });

		sqlite
			.query("UPDATE settings SET show_workspaces_in_sidebar = ? WHERE id = 1")
			.run(0);
		expect(
			sqlite.query("SELECT show_workspaces_in_sidebar FROM settings").get(),
		).toEqual({ show_workspaces_in_sidebar: 0 });
	} finally {
		sqlite.close();
	}
});
