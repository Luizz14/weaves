import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import type { PaneViewerData } from "../../../../types";
import { openCodexSession } from "./openCodexSession";

test("recent conversations focus the existing tab without replacing its manual title", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	openCodexSession(store.getState(), "saved", "First message");
	const first = store.getState().tabs[0];
	if (!first) throw Error("missing tab");
	store
		.getState()
		.setTabTitleOverride({ tabId: first.id, titleOverride: "My task" });
	openCodexSession(store.getState(), "other", "Another conversation");
	openCodexSession(store.getState(), "saved", "Updated title");
	expect(store.getState().tabs).toHaveLength(2);
	expect(store.getState().activeTabId).toBe(first.id);
	expect(store.getState().getActiveTab()?.titleOverride).toBe("My task");
});
test("reopening a closed conversation keeps its session id", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	openCodexSession(store.getState(), "saved");
	const id = store.getState().activeTabId;
	if (!id) throw Error("missing tab");
	store.getState().removeTab(id);
	openCodexSession(store.getState(), "saved");
	expect(store.getState().tabs).toHaveLength(1);
	expect(store.getState().getActivePane()?.pane.data).toMatchObject({
		sessionId: "saved",
	});
});
