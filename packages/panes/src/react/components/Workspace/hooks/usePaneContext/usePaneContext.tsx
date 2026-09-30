import { useMemo } from "react";
import {
	createPaneContext,
	type PaneContextOptions,
} from "./createPaneContext";

export function usePaneContext<TData>(options: PaneContextOptions<TData>) {
	const { store, tab, pane, isActive, registry, parentDirection, paneActions } =
		options;
	const tabPosition = store
		.getState()
		.tabs.findIndex((candidate) => candidate.id === tab.id);
	return useMemo(
		() =>
			createPaneContext(
				{ store, tab, pane, isActive, registry, parentDirection, paneActions },
				tabPosition,
			),
		[
			store,
			tab,
			pane,
			isActive,
			registry,
			parentDirection,
			paneActions,
			tabPosition,
		],
	);
}
