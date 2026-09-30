import {
	type PaneRegistry,
	type RendererContext,
	useTabTitle,
} from "@superset/panes";
import { PaneActionLayoutContext } from "renderer/components/PaneActionButton";
import type { PaneViewerData } from "../../../../types";

export function PanelActionContent({
	context,
	registry,
}: {
	context: RendererContext<PaneViewerData>;
	registry: PaneRegistry<PaneViewerData>;
}) {
	const title = useTabTitle(
		context.tab,
		context.store.getState().tabs,
		registry,
	);
	return (
		<PaneActionLayoutContext.Provider value={true}>
			<div
				className="@container/pane-header flex min-w-0 flex-col gap-0.5"
				data-panel-actions={context.pane.id}
			>
				<div
					className="truncate px-3 py-1.5 text-xs font-medium text-muted-foreground"
					title={title}
				>
					{title}
				</div>
				{registry[context.pane.kind]?.renderSoloActions?.(context)}
			</div>
		</PaneActionLayoutContext.Provider>
	);
}
