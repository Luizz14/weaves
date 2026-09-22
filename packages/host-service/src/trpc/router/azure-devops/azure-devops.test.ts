import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import type { BitriseCredentialStore } from "../../../runtime/azure-devops/bitrise-credentials";
import type { HostServiceContext } from "../../../types";
import {
	applyWorkItemStage,
	azureDevOpsRouter,
	normalizeAzureDevOpsOrganizationUrl,
} from "./azure-devops";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

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
	const credentials = new Map<string, string>();
	const bitriseCredentialStore: BitriseCredentialStore = {
		get: async (key) => credentials.get(key),
		set: async (key, value) => {
			credentials.set(key, value);
		},
		delete: async (key) => {
			credentials.delete(key);
		},
	};
	return {
		db: db as unknown as HostDb,
		organizationId: "test-organization",
		bitriseCredentialStore,
		isAuthenticated: true,
	} as unknown as HostServiceContext;
}

function insertLinkedWorkspace(
	ctx: HostServiceContext,
	branch = "feature/build-without-number",
) {
	ctx.db
		.insert(schema.workspaces)
		.values({
			id: WORKSPACE_ID,
			projectId: PROJECT_ID,
			worktreePath: "/repo/worktree",
			branch,
			type: "worktree",
			externalWorkItemProvider: "azure-devops",
			externalWorkItemId: "12345",
		})
		.run();
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

	test("stores Bitrise configuration without returning the token", async () => {
		const caller = azureDevOpsRouter.createCaller(createContext());

		await expect(
			caller.setBuildConfig({
				projectId: PROJECT_ID,
				platform: "android",
				developerNames: ["Dev Example"],
				alphaVersionValue: "3.15.",
				bitriseToken: "secret-token",
			}),
		).resolves.toEqual({
			projectId: PROJECT_ID,
			platform: "android",
			developerNames: ["Dev Example"],
			alphaVersionValue: "3.15.",
			bitriseTokenConfigured: true,
		});
	});

	test("rejects a build for a workspace not linked to the requested work item", async () => {
		const ctx = createContext();
		insertLinkedWorkspace(ctx);
		const caller = azureDevOpsRouter.createCaller(ctx);

		await expect(
			caller.generateBuild({
				workItemId: 67890,
				workspaceId: WORKSPACE_ID,
				lane: "alpha",
				developerName: "Dev Example",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	test("rejects a build when the linked branch does not contain a work item number", async () => {
		const ctx = createContext();
		insertLinkedWorkspace(ctx);
		const caller = azureDevOpsRouter.createCaller(ctx);
		await caller.setBuildConfig({
			projectId: PROJECT_ID,
			platform: "android",
			developerNames: ["Dev Example"],
			alphaVersionValue: "3.15.",
		});

		await expect(
			caller.generateBuild({
				workItemId: 12345,
				workspaceId: WORKSPACE_ID,
				lane: "alpha",
				developerName: "Dev Example",
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	test("stores board configuration separately from repository configuration", async () => {
		const caller = azureDevOpsRouter.createCaller(createContext());
		await expect(
			caller.setBoardConfig({
				organizationUrl: "https://dev.azure.com/Acme",
				workItemProject: "Work Items",
				team: "Mobile",
				areaPath: "\\Work Items/Mobile",
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

	test("moves a remotely claimed work item and records its local stage", async () => {
		const ctx = createContext();

		await expect(
			applyWorkItemStage(
				ctx,
				{ workItemId: 42, stage: "homologation" },
				async () => ({
					stage: "implementation",
					claim: {
						childId: 84,
						assignedTo: null,
						state: "In Progress",
						isCurrentUser: true,
					},
				}),
			),
		).resolves.toEqual({ stage: "homologation" });

		expect(
			ctx.db.query.azureDevOpsWorkItemStates
				.findFirst({
					where: eq(schema.azureDevOpsWorkItemStates.workItemId, 42),
				})
				.sync(),
		).toMatchObject({ stage: "homologation", childWorkItemId: 84 });
	});

	test("uses the local stage without reading the remote claim", async () => {
		const ctx = createContext();
		ctx.db
			.insert(schema.azureDevOpsWorkItemStates)
			.values({
				workItemId: 42,
				stage: "implementation",
				childWorkItemId: 84,
				createdAt: 1,
				updatedAt: 1,
			})
			.run();
		let remoteClaimRead = false;

		await expect(
			applyWorkItemStage(
				ctx,
				{ workItemId: 42, stage: "homologation" },
				async () => {
					remoteClaimRead = true;
					return { stage: "backlog", claim: null };
				},
			),
		).resolves.toEqual({ stage: "homologation" });

		expect(remoteClaimRead).toBe(false);
		expect(
			ctx.db.query.azureDevOpsWorkItemStates
				.findFirst({
					where: eq(schema.azureDevOpsWorkItemStates.workItemId, 42),
				})
				.sync(),
		).toMatchObject({ stage: "homologation", childWorkItemId: 84 });
	});

	test.each([
		["unclaimed item", null],
		[
			"another user's claim",
			{
				childId: 84,
				assignedTo: null,
				state: "In Progress",
				isCurrentUser: false,
			},
		],
	] as const)("rejects stage changes for %s without local state", async (_label, claim) => {
		const ctx = createContext();

		await expect(
			applyWorkItemStage(
				ctx,
				{ workItemId: 42, stage: "homologation" },
				async () => ({ stage: claim ? "implementation" : "backlog", claim }),
			),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	test("keeps the adjacent-stage validation for a remote claim", async () => {
		const ctx = createContext();

		await expect(
			applyWorkItemStage(
				ctx,
				{ workItemId: 42, stage: "review" },
				async () => ({
					stage: "implementation",
					claim: {
						childId: 84,
						assignedTo: null,
						state: "In Progress",
						isCurrentUser: true,
					},
				}),
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
