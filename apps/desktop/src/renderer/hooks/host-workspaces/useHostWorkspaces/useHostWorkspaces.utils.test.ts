import { describe, expect, it } from "bun:test";
import type { WorkspaceSnapshotPayload } from "@superset/workspace-client";
import {
	applyWorkspaceChangedEvent,
	isEventBusReopen,
	mergeHostWorkspaces,
	toHostWorkspaceItem,
} from "./useHostWorkspaces.utils";

const HOST = { organizationId: "org-1", machineId: "machine-1" };

function makeSnapshot(
	overrides: Partial<WorkspaceSnapshotPayload> & { id: string },
): WorkspaceSnapshotPayload {
	return {
		projectId: "project-1",
		name: overrides.id,
		branch: overrides.id,
		type: "worktree",
		worktreePath: `/tmp/${overrides.id}`,
		taskId: null,
		createdByUserId: null,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		lastActivityAt: 1_700_000_050_000,
		tags: [],
		externalWorkItemProvider: null,
		externalWorkItemId: null,
		externalWorkItemUrl: null,
		...overrides,
	};
}

describe("isEventBusReopen", () => {
	it("treats any open after the first as a reopen", () => {
		expect(isEventBusReopen(true, "open")).toBe(true);
	});

	it("does not treat the first open as a reopen", () => {
		expect(isEventBusReopen(false, "open")).toBe(false);
	});

	it("ignores transitions that do not land on open", () => {
		expect(isEventBusReopen(true, "reconnecting")).toBe(false);
		expect(isEventBusReopen(true, "closed")).toBe(false);
		expect(isEventBusReopen(true, "connecting")).toBe(false);
	});
});

describe("applyWorkspaceChangedEvent lastActivityAt", () => {
	it("carries the snapshot's lastActivityAt onto the cached row", () => {
		const rows = applyWorkspaceChangedEvent(
			undefined,
			{ eventType: "created", workspace: makeSnapshot({ id: "w1" }) },
			HOST,
			"w1",
			null,
		);
		expect(rows?.[0]?.lastActivityAt).toBe(1_700_000_050_000);
	});

	it("replaces a stale value on update", () => {
		const initial = applyWorkspaceChangedEvent(
			undefined,
			{ eventType: "created", workspace: makeSnapshot({ id: "w1" }) },
			HOST,
			"w1",
			null,
		);
		const updated = applyWorkspaceChangedEvent(
			initial,
			{
				eventType: "updated",
				workspace: makeSnapshot({
					id: "w1",
					lastActivityAt: 1_700_000_999_000,
				}),
			},
			HOST,
			"w1",
			null,
		);
		expect(updated?.[0]?.lastActivityAt).toBe(1_700_000_999_000);
	});

	it("normalizes an older host's event (no field) to null", () => {
		// Runtime shape from a host-service that predates the column.
		const legacy = makeSnapshot({ id: "w1" }) as unknown as Record<
			string,
			unknown
		>;
		delete legacy.lastActivityAt;
		const rows = applyWorkspaceChangedEvent(
			undefined,
			{
				eventType: "created",
				workspace: legacy as unknown as WorkspaceSnapshotPayload,
			},
			HOST,
			"w1",
			null,
		);
		expect(rows?.[0]?.lastActivityAt).toBeNull();
	});

	it("keeps the cached stamp when an older host's update omits the field", () => {
		const initial = applyWorkspaceChangedEvent(
			undefined,
			{ eventType: "created", workspace: makeSnapshot({ id: "w1" }) },
			HOST,
			"w1",
			null,
		);
		const legacy = makeSnapshot({ id: "w1" }) as unknown as Record<
			string,
			unknown
		>;
		delete legacy.lastActivityAt;
		const updated = applyWorkspaceChangedEvent(
			initial,
			{
				eventType: "updated",
				workspace: legacy as unknown as WorkspaceSnapshotPayload,
			},
			HOST,
			"w1",
			null,
		);
		expect(updated?.[0]?.lastActivityAt).toBe(1_700_000_050_000);
	});
});

describe("applyWorkspaceChangedEvent external work item links", () => {
	const link = {
		externalWorkItemProvider: "azure-devops",
		externalWorkItemId: "42",
		externalWorkItemUrl: "https://dev.azure.com/x/42",
	};

	it("carries a link on creation and replaces it on update", () => {
		const initial = applyWorkspaceChangedEvent(
			undefined,
			{ eventType: "created", workspace: makeSnapshot({ id: "w1", ...link }) },
			HOST,
			"w1",
			null,
		);
		expect(initial?.[0]).toMatchObject(link);
		const nextLink = {
			...link,
			externalWorkItemId: "7",
			externalWorkItemUrl: "https://dev.azure.com/x/7",
		};
		const updated = applyWorkspaceChangedEvent(
			initial,
			{
				eventType: "updated",
				workspace: makeSnapshot({ id: "w1", ...nextLink }),
			},
			HOST,
			"w1",
			null,
		);
		expect(updated).toHaveLength(1);
		expect(updated?.[0]).toMatchObject(nextLink);
	});

	it("preserves each omitted link field but accepts explicit null", () => {
		const [row] =
			applyWorkspaceChangedEvent(
				undefined,
				{ eventType: "created", workspace: makeSnapshot({ id: "w1" }) },
				HOST,
				"w1",
				null,
			) ?? [];
		if (!row) throw new Error("expected a row");
		const rows = [{ ...row, ...link }];
		for (const field of Object.keys(link) as Array<keyof typeof link>) {
			const snapshot = makeSnapshot({ id: "w1", ...link });
			delete snapshot[field];
			const updated = applyWorkspaceChangedEvent(
				rows,
				{ eventType: "updated", workspace: snapshot },
				HOST,
				"w1",
				null,
			);
			expect(updated?.[0]).toMatchObject(link);
		}
		const updated = applyWorkspaceChangedEvent(
			rows,
			{
				eventType: "updated",
				workspace: makeSnapshot({
					id: "w1",
					...link,
					externalWorkItemUrl: null,
				}),
			},
			HOST,
			"w1",
			null,
		);
		expect(updated?.[0]).toMatchObject({ ...link, externalWorkItemUrl: null });
	});
});

describe("applyWorkspaceChangedEvent tags", () => {
	it("keeps only the viewer's own and creator-less tags", () => {
		const rows = applyWorkspaceChangedEvent(
			undefined,
			{
				eventType: "created",
				workspace: makeSnapshot({
					id: "w1",
					tags: ["legacy", "mine", "theirs"],
					tagAssignments: [
						{ tag: "theirs", createdByUserId: "user-b" },
						{ tag: "mine", createdByUserId: "user-a" },
						{ tag: "legacy", createdByUserId: null },
					],
				}),
			},
			HOST,
			"w1",
			"user-a",
		);
		expect(rows?.[0]?.tags).toEqual(["legacy", "mine"]);
	});

	it("shows nobody's tags while the session is unresolved", () => {
		const initial = applyWorkspaceChangedEvent(
			undefined,
			{
				eventType: "created",
				workspace: makeSnapshot({
					id: "w1",
					tags: ["theirs"],
					tagAssignments: [{ tag: "theirs", createdByUserId: "user-b" }],
				}),
			},
			HOST,
			"w1",
			null,
		);
		expect(initial?.[0]?.tags).toEqual([]);
		const cached = initial?.map((row) => ({ ...row, tags: ["cached"] }));
		const updated = applyWorkspaceChangedEvent(
			cached,
			{
				eventType: "updated",
				workspace: makeSnapshot({
					id: "w1",
					tags: ["theirs"],
					tagAssignments: [{ tag: "theirs", createdByUserId: "user-b" }],
				}),
			},
			HOST,
			"w1",
			null,
		);
		expect(updated?.[0]?.tags).toEqual(["cached"]);
	});

	it("falls back to the union from a host that predates tag creators", () => {
		const rows = applyWorkspaceChangedEvent(
			undefined,
			{
				eventType: "created",
				workspace: makeSnapshot({ id: "w1", tags: ["shared"] }),
			},
			HOST,
			"w1",
			"user-a",
		);
		expect(rows?.[0]?.tags).toEqual(["shared"]);
	});
});

describe("toHostWorkspaceItem", () => {
	const [row] =
		applyWorkspaceChangedEvent(
			undefined,
			{ eventType: "created", workspace: makeSnapshot({ id: "w1" }) },
			HOST,
			"w1",
			null,
		) ?? [];
	if (!row) throw new Error("expected a row");

	it("keeps a served lastActivityAt", () => {
		expect(toHostWorkspaceItem(row, true).lastActivityAt).toBe(
			1_700_000_050_000,
		);
	});

	it("normalizes a row cached before the column existed to null", () => {
		const { lastActivityAt: _omitted, ...cachedBeforeColumn } = row;
		expect(toHostWorkspaceItem(cachedBeforeColumn, true).lastActivityAt).toBe(
			null,
		);
	});

	it("is what mergeHostWorkspaces produces", () => {
		const { lastActivityAt: _omitted, ...cachedBeforeColumn } = row;
		const [item] = mergeHostWorkspaces({
			hostResults: [
				{
					target: { ...HOST, hostUrl: "http://localhost:1", isLocal: true },
					rows: [cachedBeforeColumn],
					reachable: false,
				},
			],
		});
		expect(item).toMatchObject({
			id: "w1",
			lastActivityAt: null,
			hostReachable: false,
		});
	});
});
