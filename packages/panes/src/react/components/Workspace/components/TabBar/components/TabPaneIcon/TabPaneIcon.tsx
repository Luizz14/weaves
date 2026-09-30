import { PanelTop } from "lucide-react";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../../../core/store";
import type { Pane, Tab } from "../../../../../../../types";
import type { PaneRegistry } from "../../../../../../types";
import { usePaneContext } from "../../../../hooks/usePaneContext";

export function TabPaneIcon<TData>({
	store,
	tab,
	pane,
	parentDirection,
	registry,
}: {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: Tab<TData>;
	pane: Pane<TData>;
	parentDirection: "horizontal" | "vertical" | null;
	registry: PaneRegistry<TData>;
}) {
	const { context } = usePaneContext({
		store,
		tab,
		pane,
		registry,
		parentDirection,
		isActive: tab.activePaneId === pane.id,
	});
	const definition = registry[pane.kind];
	return (
		<span
			className="flex shrink-0 items-center [&>svg]:size-3.5 [&>img]:size-3.5"
			data-tab-pane-icon={pane.id}
		>
			{definition?.getTabIcon?.(context) ?? definition?.getIcon?.(context) ?? (
				<PanelTop className="size-3.5" />
			)}
		</span>
	);
}
