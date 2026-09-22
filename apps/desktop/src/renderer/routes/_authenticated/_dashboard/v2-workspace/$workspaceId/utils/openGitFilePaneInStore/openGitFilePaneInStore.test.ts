import { describe, expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import type { GitFilePaneData, PaneViewerData } from "../../types";
import { openGitFilePaneInStore } from "./openGitFilePaneInStore";

describe("historical file navigation", () => {
	const file: GitFilePaneData = {
		filePath: "src/a.ts",
		commitHash: "a".repeat(40),
		fromHash: "b".repeat(40),
		side: "new",
	};
	const setup = () => {
		const store = createWorkspaceStore<PaneViewerData>();
		store.getState().addTab({
			panes: [{ kind: "git-history", data: { kind: "git-history" } }],
		});
		return store;
	};
	test("opens a native pane beside history and focuses the same snapshot on repeat", () => {
		const store = setup();
		openGitFilePaneInStore(store, file);
		const first = store.getState().getActivePane();
		expect(first?.pane.kind).toBe("git-file");
		expect(first?.pane.data).toEqual(file);
		openGitFilePaneInStore(store, file);
		expect(store.getState().getActivePane()?.pane.id).toBe(first?.pane.id);
		expect(
			Object.values(store.getState().tabs[0]?.panes ?? {}).map(
				(pane) => pane.kind,
			),
		).toEqual(["git-history", "git-file"]);
	});
	test("a pinned snapshot stays separate from another revision and the deleted side", () => {
		const store = setup();
		openGitFilePaneInStore(store, file);
		const pane = store.getState().getActivePane()?.pane;
		if (!pane) throw new Error("Missing pane");
		store.getState().setPanePinned({ paneId: pane.id, pinned: true });
		openGitFilePaneInStore(store, { ...file, side: "old" });
		expect(store.getState().getActivePane()?.pane.id).not.toBe(pane.id);
		expect(store.getState().tabs[0]?.panes[pane.id]?.data).toEqual(file);
	});
});
