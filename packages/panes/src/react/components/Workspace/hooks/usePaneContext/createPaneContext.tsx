import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../core/store";
import type { Pane, Tab } from "../../../../../types";
import type {
	PaneActionConfig,
	PaneRegistry,
	RendererContext,
} from "../../../../types";
import { PaneHeaderActions } from "../../../PaneHeaderActions";

export interface PaneContextOptions<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: Tab<TData>;
	pane: Pane<TData>;
	isActive: boolean;
	registry: PaneRegistry<TData>;
	parentDirection?: "horizontal" | "vertical" | null;
	paneActions?:
		| PaneActionConfig<TData>[]
		| ((context: RendererContext<TData>) => PaneActionConfig<TData>[]);
}

export function createPaneContext<TData>(
	{
		store,
		tab,
		pane,
		isActive,
		registry,
		parentDirection = null,
		paneActions,
	}: PaneContextOptions<TData>,
	tabPosition = store
		.getState()
		.tabs.findIndex((candidate) => candidate.id === tab.id),
) {
	const definition = registry[pane.kind];
	const ctx: RendererContext<TData> = {
		pane: { ...pane, parentDirection },
		tab: { ...tab, position: tabPosition },
		isActive,
		store,
		actions: {
			close: async () => {
				if (definition?.onBeforeClose) {
					const allowed = await definition.onBeforeClose(pane);
					if (!allowed) return;
				}
				store.getState().closePane({ tabId: tab.id, paneId: pane.id });
			},
			focus: () =>
				store.getState().setActivePane({ tabId: tab.id, paneId: pane.id }),
			setTitle: (title: string) =>
				store.getState().setPaneTitleOverride({
					tabId: tab.id,
					paneId: pane.id,
					titleOverride: title,
				}),
			pin: () =>
				store.getState().setPanePinned({
					paneId: pane.id,
					pinned: true,
				}),
			updateData: (data: TData) =>
				store.getState().setPaneData({ paneId: pane.id, data }),
			split: (position, newPane) =>
				store.getState().splitPane({
					tabId: tab.id,
					paneId: pane.id,
					position: position === "down" ? "bottom" : "right",
					newPane,
				}),
		},
		headerActions: null,
	};

	const workspaceResolved =
		typeof paneActions === "function" ? paneActions(ctx) : (paneActions ?? []);

	const config = definition?.paneActions;
	const finalActions =
		typeof config === "function"
			? config(ctx, workspaceResolved)
			: (config ?? workspaceResolved);

	ctx.headerActions = (
		<PaneHeaderActions actions={finalActions} context={ctx} />
	);

	return { context: ctx, actions: finalActions };
}
