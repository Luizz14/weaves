import { beforeEach, describe, expect, it } from "bun:test";
import {
	RECENT_V2_WORKSPACES_LIMIT,
	type RecentV2Workspace,
	useRecentV2Workspaces,
} from "./recent-v2-workspaces";

function entry(
	workspaceId: string,
	organizationId = "org-a",
): RecentV2Workspace {
	return {
		workspaceId,
		organizationId,
		workspaceName: workspaceId,
		projectName: "project",
		branch: workspaceId,
		lastAccessedAt: 0,
	};
}

const ids = () =>
	useRecentV2Workspaces.getState().entries.map((e) => e.workspaceId);

describe("useRecentV2Workspaces", () => {
	beforeEach(() => useRecentV2Workspaces.setState({ entries: [] }));

	it("moves a revisited workspace to the front", () => {
		const { recordVisit } = useRecentV2Workspaces.getState();
		recordVisit(entry("a"));
		recordVisit(entry("b"));
		recordVisit(entry("a"));
		expect(ids()).toEqual(["a", "b"]);
	});

	it("caps the list", () => {
		const { recordVisit } = useRecentV2Workspaces.getState();
		for (let i = 0; i < RECENT_V2_WORKSPACES_LIMIT + 5; i++) {
			recordVisit(entry(`w${i}`));
		}
		expect(ids()).toHaveLength(RECENT_V2_WORKSPACES_LIMIT);
		expect(ids()[0]).toBe(`w${RECENT_V2_WORKSPACES_LIMIT + 4}`);
	});

	it("removes a workspace and drops organizations the user lost", () => {
		const { recordVisit, remove, reconcileOrganizations } =
			useRecentV2Workspaces.getState();
		recordVisit(entry("a", "org-a"));
		recordVisit(entry("b", "org-b"));
		recordVisit(entry("c", "org-a"));
		remove("c");
		reconcileOrganizations(["org-a"]);
		expect(ids()).toEqual(["a"]);
	});
});
