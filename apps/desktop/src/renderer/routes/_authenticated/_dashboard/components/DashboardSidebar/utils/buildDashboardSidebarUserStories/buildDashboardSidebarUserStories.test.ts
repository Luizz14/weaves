import { describe, expect, it } from "bun:test";
import { buildDashboardSidebarUserStories } from "./buildDashboardSidebarUserStories";

const ws = (
	id: string,
	workItemId: string | null,
	activity: number,
	hostId = "host-a",
) => ({
	id,
	hostId,
	externalWorkItemProvider: workItemId ? "azure-devops" : null,
	externalWorkItemId: workItemId,
	externalWorkItemUrl: workItemId
		? `https://dev.azure.com/x/${workItemId}`
		: null,
	lastActivityAt: activity,
	updatedAt: new Date(0),
});

describe("buildDashboardSidebarUserStories", () => {
	it("groups workspaces from any project by work item", () => {
		const stories = buildDashboardSidebarUserStories([
			ws("api", "42", 10),
			ws("web", "42", 30, "host-b"),
			ws("solo", "7", 20),
			ws("unlinked", null, 99),
		]);
		expect(stories).toEqual([
			{
				workItemId: 42,
				url: "https://dev.azure.com/x/42",
				hostId: "host-b",
				workspaceIds: ["web", "api"],
			},
			{
				workItemId: 7,
				url: "https://dev.azure.com/x/7",
				hostId: "host-a",
				workspaceIds: ["solo"],
			},
		]);
	});

	it("falls back to updatedAt when a host predates activity stamps", () => {
		const stories = buildDashboardSidebarUserStories([
			{ ...ws("old", "1", 0), lastActivityAt: null, updatedAt: new Date(5) },
			{ ...ws("new", "2", 0), lastActivityAt: null, updatedAt: new Date(9) },
		]);
		expect(stories.map((s) => s.workItemId)).toEqual([2, 1]);
	});
});
