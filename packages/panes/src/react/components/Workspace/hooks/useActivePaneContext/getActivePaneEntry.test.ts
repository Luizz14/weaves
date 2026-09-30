import { describe, expect, it } from "bun:test";
import { createWorkspaceStore } from "../../../../../core/store";
import { getActivePaneEntry } from "./getActivePaneEntry";

describe("active pane context", () => {
	it("has no target before a layout is available", () => {
		expect(getActivePaneEntry({ tabs: [], activeTabId: null })).toBeNull();
	});

	it("uses the visible solo pane even when restored selection is stale", () => {
		const store = createWorkspaceStore<null>();
		store.getState().addTab({
			id: "tab",
			panes: [{ id: "visible", kind: "file", data: null }],
		});
		const tab = store.getState().getTab("tab");
		if (!tab) throw new Error("Missing fixture tab");
		const entry = getActivePaneEntry({
			tabs: [{ ...tab, activePaneId: "missing" }],
			activeTabId: tab.id,
		});
		expect(entry?.pane.id).toBe("visible");
		expect(entry?.parentDirection).toBeNull();
	});

	it("tracks focus and the actual direction of a nested split", () => {
		const store = createWorkspaceStore<null>();
		store.getState().addTab({
			id: "tab",
			panes: [{ id: "first", kind: "terminal", data: null }],
		});
		const tab = store.getState().getTab("tab");
		if (!tab) throw new Error("Missing fixture tab");
		store.getState().splitPane({
			tabId: tab.id,
			paneId: "first",
			position: "right",
			newPane: { id: "second", kind: "file", data: null },
		});
		store.getState().splitPane({
			tabId: tab.id,
			paneId: "second",
			position: "bottom",
			newPane: { id: "third", kind: "terminal", data: null },
		});
		expect(getActivePaneEntry(store.getState())?.parentDirection).toBe(
			"vertical",
		);
		store.getState().setActivePane({ tabId: tab.id, paneId: "first" });
		expect(getActivePaneEntry(store.getState())?.pane.id).toBe("first");
		expect(getActivePaneEntry(store.getState())?.parentDirection).toBe(
			"horizontal",
		);
	});

	it("does not expose orphan panes as selected actions", () => {
		const store = createWorkspaceStore<null>();
		store.getState().addTab({
			id: "tab",
			panes: [{ id: "visible", kind: "file", data: null }],
		});
		const tab = store.getState().getTab("tab");
		if (!tab) throw new Error("Missing fixture tab");
		expect(
			getActivePaneEntry({
				tabs: [{ ...tab, layout: { type: "pane", paneId: "missing" } }],
				activeTabId: tab.id,
			}),
		).toBeNull();
	});
});
