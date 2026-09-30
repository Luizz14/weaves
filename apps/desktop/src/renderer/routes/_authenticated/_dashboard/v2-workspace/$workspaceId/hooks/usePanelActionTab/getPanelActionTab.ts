import type { PaneRegistry, RendererContext } from "@superset/panes";

export function getPanelActionDefinition<TData>(
	context: RendererContext<TData> | null,
	registry: PaneRegistry<TData>,
) {
	if (!context || context.pane.parentDirection !== null) return null;
	const definition = registry[context.pane.kind];
	return definition?.renderSoloActions &&
		definition.hasSoloActions?.(context) !== false
		? definition
		: null;
}
