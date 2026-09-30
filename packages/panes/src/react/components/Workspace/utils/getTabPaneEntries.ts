import type { LayoutNode, Pane, Tab } from "../../../../types";

export interface TabPaneEntry<TData> {
	pane: Pane<TData>;
	parentDirection: "horizontal" | "vertical" | null;
}

export function getTabPaneEntries<TData>(
	tab: Tab<TData>,
): TabPaneEntry<TData>[] {
	const entries: TabPaneEntry<TData>[] = [];
	function visit(
		node: LayoutNode,
		parentDirection: TabPaneEntry<TData>["parentDirection"],
	) {
		if (!node) return;
		if (node.type === "pane") {
			const pane = tab.panes[node.paneId];
			if (pane) entries.push({ pane, parentDirection });
		} else if (node.type === "split") {
			visit(node.first, node.direction);
			visit(node.second, node.direction);
		}
	}
	visit(tab.layout, null);
	return entries;
}
