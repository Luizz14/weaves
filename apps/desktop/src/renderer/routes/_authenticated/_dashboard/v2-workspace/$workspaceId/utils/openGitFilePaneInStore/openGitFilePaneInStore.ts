import type { WorkspaceStore } from "@superset/panes";
import type { StoreApi } from "zustand/vanilla";
import type { GitFilePaneData, PaneViewerData } from "../../types";
import { focusOrOpenPane } from "../focusOrOpenPane";

export function openGitFilePaneInStore(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	file: GitFilePaneData,
) {
	focusOrOpenPane<GitFilePaneData>(
		store,
		"git-file",
		(pane) =>
			pane.filePath === file.filePath &&
			pane.commitHash === file.commitHash &&
			pane.fromHash === file.fromHash &&
			pane.side === file.side,
		file,
	);
}
