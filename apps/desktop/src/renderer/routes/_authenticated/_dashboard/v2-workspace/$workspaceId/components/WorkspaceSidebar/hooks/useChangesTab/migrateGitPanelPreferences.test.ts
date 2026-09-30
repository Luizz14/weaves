import { expect, test } from "bun:test";
import {
	DEFAULT_V2_USER_PREFERENCES,
	healV2UserPreferences,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { migrateGitPanelPreferences } from "./migrateGitPanelPreferences";

test("migration initializes the Zed presentation once and later respects explicit choices", async () => {
	let preferences = healV2UserPreferences({
		...DEFAULT_V2_USER_PREFERENCES,
		gitPanelPresentationVersion: 0,
		changesViewMode: "tree",
		rightSidebarWidth: 420,
	});
	const row = {
		workspaceId: "workspace",
		sidebarState: { changesFilter: { kind: "all" }, activeTab: "files" },
	};
	const rows = [
		row,
		{
			workspaceId: "second",
			sidebarState: { changesFilter: { kind: "all" }, activeTab: "review" },
		},
	];
	let workspaceWrites = 0;
	const collections = {
		v2WorkspaceLocalState: {
			preload: async () => {},
			values: () => rows.values(),
			update: (_ids: string[], update: (drafts: typeof rows) => void) => {
				workspaceWrites++;
				update(rows);
			},
		},
		v2UserPreferences: {
			preload: async () => {},
			get: () => preferences,
			update: (_id: string, update: (row: typeof preferences) => void) =>
				update(preferences),
			insert: (row: typeof preferences) => {
				preferences = row;
			},
		},
	} as unknown as Parameters<typeof migrateGitPanelPreferences>[0];
	await migrateGitPanelPreferences(collections);
	expect(preferences.changesViewMode).toBe("flat");
	expect(workspaceWrites).toBe(1);
	expect(
		rows.every(
			(value) => value.sidebarState.changesFilter.kind === "uncommitted",
		),
	).toBe(true);
	expect(preferences.gitPanelPresentationVersion).toBe(1);
	expect(preferences.rightSidebarWidth).toBe(420);
	expect(rows[0]?.sidebarState.activeTab).toBe("files");
	expect(rows[0]?.sidebarState.changesFilter.kind).toBe("uncommitted");
	preferences.changesViewMode = "tree";
	row.sidebarState.changesFilter = { kind: "all" };
	await migrateGitPanelPreferences(collections);
	expect(preferences.changesViewMode).toBe("tree");
	expect(workspaceWrites).toBe(1);
	expect(rows[0]?.sidebarState.changesFilter.kind).toBe("all");
});
