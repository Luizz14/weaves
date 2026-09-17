import type { WorkspaceStore } from "@superset/panes";
import type { PaneViewerData } from "../../../../types";
export function openCodexSession(
	state: WorkspaceStore<PaneViewerData>,
	sessionId: string,
	title?: string | null,
): void {
	for (const tab of state.tabs)
		for (const pane of Object.values(tab.panes)) {
			if (
				pane.kind === "codex-chat" &&
				"sessionId" in pane.data &&
				pane.data.sessionId === sessionId
			) {
				state.setActiveTab(tab.id);
				state.setActivePane({ tabId: tab.id, paneId: pane.id });
				return;
			}
		}
	state.addTab({
		panes: [
			{ kind: "codex-chat", data: { sessionId, title: title ?? undefined } },
		],
	});
}
