import { describe, expect, test } from "bun:test";
import {
	getAzureDevOpsWorkItem,
	getAzureDevOpsWorkItemClaim,
	listAzureDevOpsBoardItems,
	listAzureDevOpsIterations,
	resolveAzureDevOpsAccount,
} from "./board";
import type { ExecAz } from "./exec-az";

const config = {
	organizationUrl: "https://dev.azure.com/acme",
	workItemProject: "Platform",
	team: "Mobile",
	areaPath: "Platform\\Mobile",
	assignedTo: "fallback@example.com",
	workItemTypes: ["Bug", "User Story"],
};

describe("Azure DevOps board", () => {
	test("normalizes team iterations", async () => {
		let timeout: number | undefined;
		const run: ExecAz = async (_args, options) => {
			timeout = options?.timeout;
			return [
				{
					id: "iteration-1",
					name: "Sprint 42",
					path: "Platform\\Sprint 42",
					attributes: {
						startDate: "2026-09-01T00:00:00Z",
						finishDate: "2026-09-14T00:00:00Z",
						timeFrame: "current",
					},
				},
			];
		};

		await expect(listAzureDevOpsIterations(run, config)).resolves.toEqual([
			{
				id: "iteration-1",
				name: "Sprint 42",
				path: "Platform\\Sprint 42",
				startDate: "2026-09-01T00:00:00Z",
				finishDate: "2026-09-14T00:00:00Z",
				isCurrent: true,
			},
		]);
		expect(timeout).toBe(45_000);
	});

	test("loads work item fields and relations without expanding every detail", async () => {
		let timeout: number | undefined;
		let args: string[] = [];
		const run: ExecAz = async (command, options) => {
			args = command;
			timeout = options?.timeout;
			return {
				id: 367289,
				rev: 41,
				url: "https://dev.azure.com/acme/_apis/wit/workItems/367289",
				fields: { "System.Title": "Example" },
				relations: [],
			};
		};

		await expect(
			getAzureDevOpsWorkItem(run, config, 367289),
		).resolves.toMatchObject({
			id: 367289,
			fields: { "System.Title": "Example" },
		});
		expect(timeout).toBe(45_000);
		expect(args).toContain("relations");
		expect(args).not.toContain("all");
	});

	test("finds an implementation claim with a work-item-scoped query", async () => {
		const calls: string[][] = [];
		const run: ExecAz = async (args) => {
			calls.push(args);
			if (args[0] === "account") {
				return { user: { name: "me@example.com" } };
			}
			return [
				{
					id: 99,
					rev: 1,
					url: "https://dev.azure.com/acme/_apis/wit/workItems/99",
					fields: {
						"System.Title": "Em implementação",
						"System.State": "In Progress",
						"System.Parent": 42,
						"System.AssignedTo": {
							displayName: "Me",
							uniqueName: "me@example.com",
						},
					},
				},
			];
		};

		await expect(
			getAzureDevOpsWorkItemClaim(run, config, 42),
		).resolves.toMatchObject({
			stage: "implementation",
			claim: { childId: 99, isCurrentUser: true },
		});
		const wiqlCall = calls.find((args) => args[1] === "query");
		expect(wiqlCall?.[wiqlCall.indexOf("--wiql") + 1]).toContain(
			"[System.Parent] = 42",
		);
		expect(calls).toHaveLength(2);
	});

	test("identifies implementation claims owned by another user", async () => {
		const run: ExecAz = async (args) => {
			if (args[0] === "account") {
				return { user: { name: "me@example.com" } };
			}
			return [
				{
					id: 100,
					rev: 2,
					url: "https://dev.azure.com/acme/_apis/wit/workItems/100",
					fields: {
						"System.Title": "Em implementação",
						"System.State": "In Progress",
						"System.Parent": 42,
						"System.AssignedTo": {
							displayName: "Another developer",
							uniqueName: "other@example.com",
						},
					},
				},
			];
		};

		await expect(
			getAzureDevOpsWorkItemClaim(run, config, 42),
		).resolves.toMatchObject({
			stage: "implementation",
			claim: { childId: 100, isCurrentUser: false },
		});
	});

	test("uses backlog stage when the parent has no active implementation child", async () => {
		const run: ExecAz = async (args) => {
			if (args[0] === "account") {
				return { user: { name: "me@example.com" } };
			}
			return [];
		};

		await expect(getAzureDevOpsWorkItemClaim(run, config, 42)).resolves.toEqual(
			{
				claim: null,
				stage: "backlog",
			},
		);
	});

	test("uses the configured identity when az account is unavailable", async () => {
		const run: ExecAz = async () => {
			throw new Error("not logged in");
		};
		await expect(
			resolveAzureDevOpsAccount(run, "fallback@example.com"),
		).resolves.toBe("fallback@example.com");
	});

	test("joins implementation children to their parent", async () => {
		let call = 0;
		const run: ExecAz = async (args) => {
			call++;
			if (args[0] === "account") {
				return { user: { name: "me@example.com" } };
			}
			if (call === 2) {
				return [
					{
						id: 42,
						rev: 3,
						url: "https://dev.azure.com/acme/_apis/wit/workItems/42",
						fields: {
							"System.Title": "Fix login",
							"System.State": "Accepted",
							"System.WorkItemType": "Bug",
							"System.IterationPath": "Platform\\Sprint 42",
							"System.AreaPath": "Platform\\Mobile",
						},
					},
				];
			}
			return [
				{
					id: 99,
					rev: 1,
					url: "https://dev.azure.com/acme/_apis/wit/workItems/99",
					fields: {
						"System.Title": "Em implementação",
						"System.State": "In Progress",
						"System.Parent": 42,
						"System.AssignedTo": {
							displayName: "Me",
							uniqueName: "me@example.com",
						},
					},
				},
			];
		};

		const board = await listAzureDevOpsBoardItems(
			run,
			config,
			"Platform\\Sprint 42",
		);
		expect(board.items[0]?.claim).toMatchObject({
			childId: 99,
			isCurrentUser: true,
		});
	});

	test("normalizes area path separators in WIQL queries", async () => {
		const queries: string[] = [];
		const run: ExecAz = async (args) => {
			if (args[0] === "boards" && args[1] === "query") {
				const wiql = args[args.indexOf("--wiql") + 1];
				if (wiql) queries.push(wiql);
			}
			return [];
		};

		await listAzureDevOpsBoardItems(
			run,
			{ ...config, areaPath: "\\TI Banese/Area/SUTEC App Banese" },
			"Platform\\Sprint 42",
		);

		expect(queries).toHaveLength(2);
		expect(queries[0]).toContain(
			"[System.AreaPath] UNDER 'TI Banese\\Area\\SUTEC App Banese'",
		);
	});
});
