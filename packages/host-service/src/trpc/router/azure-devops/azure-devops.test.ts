import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import {
	azureDevOpsRouter,
	normalizeAzureDevOpsOrganizationUrl,
} from "./azure-devops";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function createContext(): HostServiceContext {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			name: "Superset",
			repoPath: "/repo",
			createdAt: 1,
			updatedAt: 1,
		})
		.run();
	return {
		db: db as unknown as HostDb,
		isAuthenticated: true,
	} as unknown as HostServiceContext;
}

describe("azureDevOpsRouter", () => {
	test("saves, normalizes, updates, and removes project configuration", async () => {
		const caller = azureDevOpsRouter.createCaller(createContext());

		await expect(
			caller.setProjectConfig({
				projectId: PROJECT_ID,
				organizationUrl: " https://dev.azure.com/Acme/ ",
				azureProject: " Platform ",
				repository: " Superset ",
			}),
		).resolves.toMatchObject({
			organizationUrl: "https://dev.azure.com/Acme",
			azureProject: "Platform",
			repository: "Superset",
		});

		await caller.setProjectConfig({
			projectId: PROJECT_ID,
			organizationUrl: "https://dev.azure.com/Acme",
			azureProject: "Applications",
			repository: "Desktop",
		});
		await expect(
			caller.getProjectConfig({ projectId: PROJECT_ID }),
		).resolves.toMatchObject({
			azureProject: "Applications",
			repository: "Desktop",
		});

		await expect(
			caller.removeProjectConfig({ projectId: PROJECT_ID }),
		).resolves.toEqual({ ok: true });
		await expect(
			caller.getProjectConfig({ projectId: PROJECT_ID }),
		).resolves.toBeNull();
	});

	test("rejects unsupported organization URLs", () => {
		expect(() =>
			normalizeAzureDevOpsOrganizationUrl(
				"https://acme.visualstudio.com/Platform",
			),
		).toThrow("https://dev.azure.com/organization");
		expect(() =>
			normalizeAzureDevOpsOrganizationUrl(
				"https://dev.azure.com/acme/Platform",
			),
		).toThrow("https://dev.azure.com/organization");
	});

	test("rejects a project that is not on this host", async () => {
		const caller = azureDevOpsRouter.createCaller(createContext());
		await expect(
			caller.getProjectConfig({
				projectId: "22222222-2222-4222-8222-222222222222",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("reports an unconfigured project without invoking Azure CLI", async () => {
		const caller = azureDevOpsRouter.createCaller(createContext());

		await expect(
			caller.diagnoseProject({ projectId: PROJECT_ID }),
		).resolves.toEqual({
			status: "not_configured",
			cliVersion: null,
			extensionVersion: null,
			repository: null,
		});
	});

	test("stores board configuration separately from repository configuration", async () => {
		const caller = azureDevOpsRouter.createCaller(createContext());
		await expect(
			caller.setBoardConfig({
				organizationUrl: "https://dev.azure.com/Acme",
				workItemProject: "Work Items",
				team: "Mobile",
				areaPath: "Work Items\\Mobile",
				assignedTo: "me@example.com",
				workItemTypes: ["Bug", "User Story"],
			}),
		).resolves.toEqual({
			organizationUrl: "https://dev.azure.com/Acme",
			workItemProject: "Work Items",
			team: "Mobile",
			areaPath: "Work Items\\Mobile",
			assignedTo: "me@example.com",
			workItemTypes: ["Bug", "User Story"],
		});
		await expect(caller.getBoardConfig()).resolves.toMatchObject({
			workItemProject: "Work Items",
		});
	});
});
