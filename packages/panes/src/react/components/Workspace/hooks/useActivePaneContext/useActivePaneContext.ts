import { useMemo } from "react";
import { useStore } from "zustand";
import type { WorkspaceProps } from "../../../../types";
import { createPaneContext } from "../usePaneContext/createPaneContext";
import { getActivePaneEntry } from "./getActivePaneEntry";

export function useActivePaneContext<TData>({
	store,
	registry,
	paneActions,
}: Pick<WorkspaceProps<TData>, "store" | "registry" | "paneActions">) {
	const tabs = useStore(store, (state) => state.tabs);
	const activeTabId = useStore(store, (state) => state.activeTabId);
	return useMemo(() => {
		const entry = getActivePaneEntry({ tabs, activeTabId });
		return entry
			? createPaneContext({
					...entry,
					store,
					registry,
					paneActions,
					isActive: true,
				}).context
			: null;
	}, [tabs, activeTabId, store, registry, paneActions]);
}
