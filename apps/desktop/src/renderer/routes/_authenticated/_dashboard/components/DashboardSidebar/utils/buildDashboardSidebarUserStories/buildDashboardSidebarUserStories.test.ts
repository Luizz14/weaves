import { describe, expect, it } from "bun:test";
import type { WorkspaceSnapshotPayload } from "@superset/workspace-client";
import {
	applyWorkspaceChangedEvent,
	type HostWorkspaceRow,
	mergeHostWorkspaces,
} from "renderer/hooks/host-workspaces/useHostWorkspaces/useHostWorkspaces.utils";
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

	it("keeps the same story through streamed metadata and activity updates until unlink", () => {
		const host = { organizationId: "org-1", machineId: "host-a" };
		const snapshot: WorkspaceSnapshotPayload = {
			id: "api",
			projectId: "project-1",
			name: "api",
			branch: "feature/42",
			type: "worktree",
			worktreePath: "/tmp/api",
			taskId: null,
			createdByUserId: null,
			createdAt: 0,
			updatedAt: 10,
			lastActivityAt: 10,
			tags: [],
			externalWorkItemProvider: "azure-devops",
			externalWorkItemId: "42",
			externalWorkItemUrl: "https://dev.azure.com/x/42",
		};
		const [base] =
			applyWorkspaceChangedEvent(
				undefined,
				{ eventType: "created", workspace: snapshot },
				host,
				snapshot.id,
				null,
			) ?? [];
		if (!base) throw new Error("expected a row");
		let rows: HostWorkspaceRow[] = [{ ...base, ...ws("api", "42", 10) }];
		const projectStories = () =>
			buildDashboardSidebarUserStories(
				mergeHostWorkspaces({
					hostResults: [
						{
							target: { ...host, hostUrl: "http://localhost:1", isLocal: true },
							rows,
							reachable: true,
						},
					],
				}),
			);
		const expected = projectStories();
		const {
			externalWorkItemProvider: _provider,
			externalWorkItemId: _id,
			externalWorkItemUrl: _url,
			...partial
		} = snapshot;
		for (const update of [
			{ ...snapshot, name: "Renamed", updatedAt: 20 },
			{ ...snapshot, branch: "feature/new-name", updatedAt: 30 },
			{ ...partial, tags: ["background"], updatedAt: 40 },
			{ ...partial, lastActivityAt: 50, updatedAt: 50 },
		]) {
			rows =
				applyWorkspaceChangedEvent(
					rows,
					{ eventType: "updated", workspace: update },
					host,
					snapshot.id,
					null,
				) ?? [];
			expect(rows).toHaveLength(1);
			expect(projectStories()).toEqual(expected);
		}
		rows =
			applyWorkspaceChangedEvent(
				rows,
				{
					eventType: "updated",
					workspace: {
						...snapshot,
						externalWorkItemProvider: null,
						externalWorkItemId: null,
						externalWorkItemUrl: null,
					},
				},
				host,
				snapshot.id,
				null,
			) ?? [];
		expect(projectStories()).toEqual([]);
		rows =
			applyWorkspaceChangedEvent(
				rows,
				{ eventType: "updated", workspace: { ...partial, lastActivityAt: 60 } },
				host,
				snapshot.id,
				null,
			) ?? [];
		expect(rows).toHaveLength(1);
		expect(projectStories()).toEqual([]);
	});
});
