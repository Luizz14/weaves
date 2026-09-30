import type { OrgCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";
import {
	DEFAULT_V2_USER_PREFERENCES,
	V2_USER_PREFERENCES_ID,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";

export async function migrateGitPanelPreferences(
	collections: Pick<
		OrgCollections,
		"v2WorkspaceLocalState" | "v2UserPreferences"
	>,
	cancelled: () => boolean = () => false,
) {
	await Promise.all([
		collections.v2WorkspaceLocalState.preload(),
		collections.v2UserPreferences.preload(),
	]);
	if (cancelled()) return;
	const current = collections.v2UserPreferences.get(V2_USER_PREFERENCES_ID);
	if (current?.gitPanelPresentationVersion === 1) return;
	const workspaceIds = [...collections.v2WorkspaceLocalState.values()].map(
		(row) => row.workspaceId,
	);
	if (workspaceIds.length)
		collections.v2WorkspaceLocalState.update(workspaceIds, (drafts) => {
			for (const draft of drafts)
				draft.sidebarState.changesFilter = { kind: "uncommitted" };
		});
	if (current)
		collections.v2UserPreferences.update(V2_USER_PREFERENCES_ID, (draft) => {
			draft.changesViewMode = "flat";
			draft.gitPanelPresentationVersion = 1;
		});
	else collections.v2UserPreferences.insert({ ...DEFAULT_V2_USER_PREFERENCES });
}
