import type { CreatePaneInput, WorkspaceStore } from "@superset/panes";
import type { StoreApi } from "zustand/vanilla";

export function attachCreatedAgentPane<TData>({
	store,
	sourcePaneId,
	placement,
	pane,
}: {
	store: StoreApi<WorkspaceStore<TData>>;
	sourcePaneId?: string;
	placement: "split-pane" | "new-tab";
	pane: CreatePaneInput<TData>;
}) {
	const state = store.getState();
	const source = sourcePaneId ? state.getPane(sourcePaneId) : null;
	if (placement === "split-pane" && source) {
		state.addPane({
			tabId: source.tabId,
			relativeToPaneId: source.pane.id,
			pane,
		});
	} else {
		state.addTab({ panes: [pane] });
	}
}
