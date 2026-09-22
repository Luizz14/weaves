import { describe, expect, test } from "bun:test";
import {
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
		const run: ExecAz = async () => [
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
});
