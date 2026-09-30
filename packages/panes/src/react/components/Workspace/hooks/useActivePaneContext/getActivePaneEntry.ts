import type { WorkspaceState } from "../../../../../types";
import { getTabPaneEntries } from "../../utils/getTabPaneEntries";

export function getActivePaneEntry<TData>(
	state: Pick<WorkspaceState<TData>, "tabs" | "activeTabId">,
) {
	const tab = state.tabs.find(
		(candidate) => candidate.id === state.activeTabId,
	);
	if (!tab) return null;
	const entries = getTabPaneEntries(tab);
	const entry =
		tab.layout?.type === "pane"
			? entries[0]
			: entries.find(({ pane }) => pane.id === tab.activePaneId);
	return entry ? { tab, ...entry } : null;
}
