import { beforeEach, describe, expect, test } from "bun:test";
import {
	migrateLastActiveV2WorkspaceState,
	useLastActiveV2Workspace,
} from "./last-active-v2-workspace";

beforeEach(() => {
	useLastActiveV2Workspace.setState({
		workspaceIdsByOrganizationId: {},
		pendingOrganizationSwitch: null,
	});
});

describe("last active v2 workspace", () => {
	test("remembers an independent workspace for each organization", () => {
		const store = useLastActiveV2Workspace.getState();
		store.recordWorkspace("org-a", "workspace-a");
		store.recordWorkspace("org-b", "workspace-b");

		expect(
			useLastActiveV2Workspace.getState().workspaceIdsByOrganizationId,
		).toEqual({
			"org-a": "workspace-a",
			"org-b": "workspace-b",
		});
	});

	test("captures the destination before switching organizations", () => {
		const store = useLastActiveV2Workspace.getState();
		store.recordWorkspace("org-a", "workspace-a");
		store.prepareOrganizationSwitch("org-a");

		expect(
			useLastActiveV2Workspace.getState().pendingOrganizationSwitch,
		).toEqual({
			organizationId: "org-a",
			targetWorkspaceId: "workspace-a",
			hasReachedTarget: false,
		});
	});

	test("keeps the restore context until navigation leaves the restored workspace", () => {
		const store = useLastActiveV2Workspace.getState();
		store.recordWorkspace("org-a", "workspace-a");
		store.prepareOrganizationSwitch("org-a");
		store.recordWorkspace("org-a", "workspace-a");

		expect(
			useLastActiveV2Workspace.getState().pendingOrganizationSwitch,
		).toEqual({
			organizationId: "org-a",
			targetWorkspaceId: "workspace-a",
			hasReachedTarget: true,
		});

		useLastActiveV2Workspace.getState().recordWorkspace("org-a", "workspace-b");
		expect(
			useLastActiveV2Workspace.getState().pendingOrganizationSwitch,
		).toBeNull();
	});

	test("clears a stale destination without deleting a newer selection", () => {
		const store = useLastActiveV2Workspace.getState();
		store.recordWorkspace("org-a", "workspace-new");
		store.prepareOrganizationSwitch("org-a");
		store.clearWorkspace("org-a", "workspace-old");

		expect(
			useLastActiveV2Workspace.getState().workspaceIdsByOrganizationId,
		).toEqual({ "org-a": "workspace-new" });
		expect(
			useLastActiveV2Workspace.getState().pendingOrganizationSwitch,
		).toBeNull();
	});

	test("reconciles remembered destinations with current memberships", () => {
		const store = useLastActiveV2Workspace.getState();
		store.recordWorkspace("org-a", "workspace-a");
		store.recordWorkspace("org-b", "workspace-b");
		store.reconcileOrganizations(["org-b"]);

		expect(
			useLastActiveV2Workspace.getState().workspaceIdsByOrganizationId,
		).toEqual({ "org-b": "workspace-b" });
	});

	test("drops the legacy organization-agnostic workspace during migration", () => {
		expect(
			migrateLastActiveV2WorkspaceState(
				{ workspaceId: "workspace-with-unknown-organization" },
				1,
			),
		).toEqual({ workspaceIdsByOrganizationId: {} });
	});

	test("rehydrates the legacy persisted store without assigning it to an organization", async () => {
		localStorage.setItem(
			"last-active-v2-workspace",
			JSON.stringify({
				version: 1,
				state: { workspaceId: "workspace-with-unknown-organization" },
			}),
		);

		await useLastActiveV2Workspace.persist.rehydrate();

		expect(
			useLastActiveV2Workspace.getState().workspaceIdsByOrganizationId,
		).toEqual({});
	});
});
