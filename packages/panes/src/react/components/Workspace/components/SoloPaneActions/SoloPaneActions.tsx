import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../core/store";
import type { Pane, Tab } from "../../../../../types";
import type { PaneRegistry, WorkspaceProps } from "../../../../types";
import { PaneHeaderActions } from "../../../PaneHeaderActions";
import { usePaneContext } from "../../hooks/usePaneContext";

export function SoloPaneActions<TData>({
	store,
	tab,
	pane,
	registry,
	paneActions,
}: {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: Tab<TData>;
	pane: Pane<TData>;
	registry: PaneRegistry<TData>;
	paneActions: WorkspaceProps<TData>["paneActions"];
}) {
	const { context, actions } = usePaneContext({
		store,
		tab,
		pane,
		registry,
		paneActions,
		isActive: true,
	});
	const headerActions = (
		<PaneHeaderActions
			actions={actions.filter((action) => action.key !== "close")}
			context={context}
		/>
	);
	return (
		<div className="flex items-center gap-1" data-solo-pane-actions={pane.id}>
			{headerActions}
		</div>
	);
}
