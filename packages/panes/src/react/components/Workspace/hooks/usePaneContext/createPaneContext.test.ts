import { describe, expect, it } from "bun:test";
import { createWorkspaceStore } from "../../../../../core/store";
import { createPaneContext } from "./createPaneContext";

describe("pane action targets", () => {
	it("keeps delayed close confirmation bound to its source pane", async () => {
		const store = createWorkspaceStore<null>();
		store.getState().addTab({
			id: "source-tab",
			panes: [{ id: "source", kind: "file", data: null }],
		});
		const source = store.getState().getTab("source-tab");
		if (!source) throw new Error("Missing fixture tab");
		store.getState().addTab({
			id: "other-tab",
			panes: [{ id: "other", kind: "file", data: null }],
		});
		const other = store.getState().getTab("other-tab");
		if (!other) throw new Error("Missing fixture tab");
		const pane = source.panes.source;
		if (!pane) throw new Error("Missing fixture pane");
		let confirm: (allowed: boolean) => void = () => {};
		const { context } = createPaneContext({
			store,
			tab: source,
			pane,
			isActive: true,
			registry: {
				file: {
					renderPane: () => null,
					onBeforeClose: () =>
						new Promise<boolean>((resolve) => {
							confirm = resolve;
						}),
				},
			},
		});
		const closing = context.actions.close();
		store.getState().setActiveTab(other.id);
		confirm(true);
		await closing;
		expect(store.getState().getPane("source")).toBeNull();
		expect(store.getState().getPane("other")?.tabId).toBe(other.id);
	});

	it("preserves the pane when close is cancelled", async () => {
		const store = createWorkspaceStore<null>();
		store.getState().addTab({
			id: "tab",
			panes: [{ id: "source", kind: "file", data: null }],
		});
		const tab = store.getState().getTab("tab");
		if (!tab) throw new Error("Missing fixture tab");
		const pane = tab.panes.source;
		if (!pane) throw new Error("Missing fixture pane");
		const { context } = createPaneContext({
			store,
			tab,
			pane,
			isActive: true,
			registry: {
				file: { renderPane: () => null, onBeforeClose: () => false },
			},
		});
		await context.actions.close();
		expect(store.getState().getPane("source")?.pane.id).toBe("source");
	});

	it("splits the source pane even if another tab is selected", () => {
		const store = createWorkspaceStore<null>();
		store.getState().addTab({
			id: "source-tab",
			panes: [{ id: "source", kind: "terminal", data: null }],
		});
		const source = store.getState().getTab("source-tab");
		if (!source) throw new Error("Missing fixture tab");
		store.getState().addTab({
			id: "other-tab",
			panes: [{ id: "other", kind: "terminal", data: null }],
		});
		const other = store.getState().getTab("other-tab");
		if (!other) throw new Error("Missing fixture tab");
		const pane = source.panes.source;
		if (!pane) throw new Error("Missing fixture pane");
		const { context } = createPaneContext({
			store,
			tab: source,
			pane,
			isActive: true,
			registry: {},
		});
		store.getState().setActiveTab(other.id);
		context.actions.split("right", { id: "new", kind: "terminal", data: null });
		expect(store.getState().getPane("new")?.tabId).toBe(source.id);
		expect(Object.keys(store.getState().getTab(other.id)?.panes ?? {})).toEqual(
			["other"],
		);
	});
});
