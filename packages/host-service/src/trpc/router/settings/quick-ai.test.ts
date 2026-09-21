import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { quickAiSettingsRouter } from "./quick-ai";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

function createCaller() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	const ctx = { db, isAuthenticated: true } as unknown as HostServiceContext;
	return quickAiSettingsRouter.createCaller(ctx);
}

describe("quickAiSettingsRouter", () => {
	it("defaults to Antigravity with Gemini Flash Low", async () => {
		await expect(createCaller().get()).resolves.toEqual({
			provider: "agy",
			model: "gemini-3.8-flash-low",
		});
	});

	it("persists the selected Antigravity model", async () => {
		const caller = createCaller();
		await caller.set({ provider: "agy", model: "gemini-3.1-pro-low" });
		await expect(caller.get()).resolves.toEqual({
			provider: "agy",
			model: "gemini-3.1-pro-low",
		});
	});
});
