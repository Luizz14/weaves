import { describe, expect, it } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import { attachCreatedAgentPane } from "./attachCreatedAgentPane";

function setup() {
	const store = createWorkspaceStore<null>();
	store.getState().addTab({
		id: "source-tab",
		panes: [{ id: "source", kind: "terminal", data: null }],
	});
	store.getState().addTab({
		id: "other-tab",
		panes: [{ id: "other", kind: "terminal", data: null }],
	});
	return store;
}

describe("created agent session placement", () => {
	it("attaches to the source even if a different tab became active", () => {
		const store = setup();
		attachCreatedAgentPane({
			store,
			sourcePaneId: "source",
			placement: "split-pane",
			pane: { id: "created", kind: "terminal", data: null },
		});
		expect(store.getState().getPane("created")?.tabId).toBe("source-tab");
		expect(
			Object.keys(store.getState().getTab("other-tab")?.panes ?? {}),
		).toEqual(["other"]);
	});

	it("splits the source rather than a sibling selected while the launch was pending", () => {
		const store = setup();
		store.getState().splitPane({
			tabId: "source-tab",
			paneId: "source",
			position: "right",
			newPane: { id: "sibling", kind: "terminal", data: null },
		});
		attachCreatedAgentPane({
			store,
			sourcePaneId: "source",
			placement: "split-pane",
			pane: { id: "created", kind: "terminal", data: null },
		});
		const layout = store.getState().getTab("source-tab")?.layout;
		if (layout?.type !== "split" || layout.first.type !== "split")
			throw new Error("Expected a split beside the source");
		expect(layout.first.first).toEqual({ type: "pane", paneId: "source" });
		expect(layout.first.second).toEqual({ type: "pane", paneId: "created" });
		expect(layout.second).toEqual({ type: "pane", paneId: "sibling" });
	});

	it("follows the source pane if it was moved to another tab", () => {
		const store = setup();
		store.getState().movePaneToNewTab({ paneId: "source", toIndex: 1 });
		const destination = store.getState().getPane("source")?.tabId;
		attachCreatedAgentPane({
			store,
			sourcePaneId: "source",
			placement: "split-pane",
			pane: { id: "created", kind: "terminal", data: null },
		});
		expect(store.getState().getPane("created")?.tabId).toBe(destination);
	});

	it("opens a new tab if the source closed before the launch finished", () => {
		const store = setup();
		store.getState().closePane({ tabId: "source-tab", paneId: "source" });
		attachCreatedAgentPane({
			store,
			sourcePaneId: "source",
			placement: "split-pane",
			pane: { id: "created", kind: "terminal", data: null },
		});
		expect(store.getState().getPane("created")?.tabId).not.toBe("other-tab");
		expect(store.getState().getPane("created")?.pane.id).toBe("created");
	});

	it("honors an explicit new-tab placement", () => {
		const store = setup();
		attachCreatedAgentPane({
			store,
			sourcePaneId: "source",
			placement: "new-tab",
			pane: { id: "created", kind: "terminal", data: null },
		});
		expect(store.getState().getPane("created")?.tabId).not.toBe("source-tab");
		expect(
			Object.keys(store.getState().getTab("source-tab")?.panes ?? {}),
		).toEqual(["source"]);
	});
});
