import { describe, expect, it } from "bun:test";
import type { Tab } from "../../../../types";
import { getTabPaneEntries } from "./getTabPaneEntries";

describe("tab pane icons in layout order", () => {
	const tab = {
		id: "tab",
		createdAt: 0,
		activePaneId: "second",
		panes: {
			second: { id: "second", kind: "terminal", data: null },
			first: { id: "first", kind: "file", data: null },
			third: { id: "third", kind: "terminal", data: null },
			unused: { id: "unused", kind: "file", data: null },
		},
		layout: {
			type: "split",
			direction: "horizontal",
			first: { type: "pane", paneId: "first" },
			second: {
				type: "split",
				direction: "vertical",
				first: { type: "pane", paneId: "second" },
				second: { type: "pane", paneId: "third" },
			},
		},
	} satisfies Tab<null>;

	it("includes every visible pane, including repeated kinds, in visual order", () => {
		expect(
			getTabPaneEntries(tab).map(({ pane, parentDirection }) => [
				pane.id,
				parentDirection,
			]),
		).toEqual([
			["first", "horizontal"],
			["second", "vertical"],
			["third", "vertical"],
		]);
	});

	it("identifies a solo pane independently of stale active selection", () => {
		expect(
			getTabPaneEntries({ ...tab, layout: { type: "pane", paneId: "first" } }),
		).toEqual([{ pane: tab.panes.first, parentDirection: null }]);
	});

	it("skips missing panes in a restored layout", () => {
		expect(
			getTabPaneEntries({ ...tab, panes: { first: tab.panes.first } }).map(
				({ pane }) => pane.id,
			),
		).toEqual(["first"]);
	});
});
