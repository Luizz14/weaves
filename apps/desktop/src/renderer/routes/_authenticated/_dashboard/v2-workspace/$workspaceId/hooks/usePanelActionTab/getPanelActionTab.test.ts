import { describe, expect, it } from "bun:test";
import {
	createWorkspaceStore,
	type PaneRegistry,
	type RendererContext,
} from "@superset/panes";
import { getPanelActionDefinition } from "./getPanelActionTab";

const store = createWorkspaceStore<null>();
const pane = { id: "pane", kind: "file", data: null };
const context: RendererContext<null> = {
	pane: { ...pane, parentDirection: null },
	tab: {
		id: "tab",
		panes: { pane },
		activePaneId: "pane",
		layout: { type: "pane", paneId: "pane" },
		createdAt: 0,
		position: 0,
	},
	store,
	isActive: true,
	headerActions: "split and close",
	actions: {
		close: () => {},
		focus: () => {},
		setTitle: () => {},
		pin: () => {},
		updateData: () => {},
		split: () => {},
	},
};

describe("panel-specific tool tab", () => {
	it("does not show a tab for generic split and close alone", () => {
		expect(
			getPanelActionDefinition(context, { file: { renderPane: () => null } }),
		).toBeNull();
		expect(getPanelActionDefinition(null, {})).toBeNull();
	});

	it("defers rendering the controls until React mounts the tool content", () => {
		const definition = {
			renderPane: () => null,
			renderSoloActions: () => {
				throw new Error("Must not inspect rendered elements for availability");
			},
		};
		expect(getPanelActionDefinition(context, { file: definition })).toBe(
			definition,
		);
	});

	it("keeps split-pane actions in their headers", () => {
		const registry: PaneRegistry<null> = {
			file: { renderPane: () => null, renderSoloActions: () => "copy path" },
		};
		expect(
			getPanelActionDefinition(
				{
					...context,
					pane: { ...context.pane, parentDirection: "horizontal" },
				},
				registry,
			),
		).toBeNull();
		expect(
			getPanelActionDefinition(
				{ ...context, pane: { ...context.pane, parentDirection: "vertical" } },
				registry,
			),
		).toBeNull();
	});

	it("hides unavailable action sets instead of producing an empty tab", () => {
		expect(
			getPanelActionDefinition(context, {
				file: {
					renderPane: () => null,
					renderSoloActions: () => "open PR",
					hasSoloActions: () => false,
				},
			}),
		).toBeNull();
	});
});
