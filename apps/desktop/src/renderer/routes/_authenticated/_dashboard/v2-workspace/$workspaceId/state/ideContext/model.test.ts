import { describe, expect, it } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { WorkspaceState } from "@superset/panes";
import {
	type IdeContextSnapshot,
	ideContextSnapshotSchema,
} from "@superset/shared/ide-context";
import type { PaneViewerData } from "../../types";
import type { SharedFileDocument } from "../fileDocumentStore";
import { IdeContextModel } from "./model";

const producer = "00000000-0000-4000-8000-000000000001";
function document(
	path: string,
	initial = "before selected after",
	workspaceId = "ws",
) {
	let value = initial;
	let version = 1;
	let currentPath = path;
	let orphaned = false;
	let binary = false;
	const doc = {
		id: path,
		workspaceId,
		get absolutePath() {
			return currentPath;
		},
		get content() {
			return { kind: "text", value, revision: "disk" };
		},
		get orphaned() {
			return orphaned;
		},
		get isBinary() {
			return binary;
		},
		getVersion: () => version,
		setContent: (next: string) => {
			value = next;
			version++;
		},
	} as SharedFileDocument;
	return {
		doc,
		rename: (path: string) => {
			currentPath = path;
			version++;
		},
		orphan: () => {
			orphaned = true;
		},
		binary: () => {
			binary = true;
		},
	};
}
function view(text: string, from = 7, to = 15) {
	return {
		state: EditorState.create({
			doc: text,
			selection: EditorSelection.range(from, to),
		}),
		dom: new EventTarget(),
		hasFocus: false,
	} as unknown as EditorView;
}
function fixture() {
	const a = document("/root/a.ts");
	const b = document("/root/b.ts");
	const documents = new Map([
		[a.doc.absolutePath, a.doc],
		[b.doc.absolutePath, b.doc],
	]);
	const file = (id: string, path: string) => ({
		id,
		kind: "file",
		data: { filePath: path, mode: "editor" as const },
	});
	const layout: WorkspaceState<PaneViewerData> = {
		version: 1,
		activeTabId: "tab-a",
		tabs: [
			{
				id: "tab-a",
				createdAt: 0,
				activePaneId: "a",
				layout: { type: "pane", paneId: "a" },
				panes: {
					a: file("a", a.doc.absolutePath),
					split: file("split", a.doc.absolutePath),
					terminal: {
						id: "terminal",
						kind: "terminal",
						data: { terminalId: "terminal" },
					},
				},
			},
			{
				id: "tab-b",
				createdAt: 0,
				activePaneId: "b",
				layout: { type: "pane", paneId: "b" },
				panes: {
					b: file("b", b.doc.absolutePath),
					historical: {
						id: "historical",
						kind: "git-file",
						data: {
							filePath: "/root/old.ts",
							commitHash: "old",
							fromHash: "older",
							side: "old",
						},
					},
				},
			},
		],
	};
	const model = new IdeContextModel(
		{ workspaceId: "ws", organizationId: "org", hostUrl: "http://host" },
		() => layout,
		(path) => documents.get(path) ?? null,
	);
	const snapshot = (): IdeContextSnapshot => model.snapshot(producer, 1);
	return { a, b, layout, model, snapshot };
}

function firstTab(layout: WorkspaceState<PaneViewerData>) {
	const tab = layout.tabs[0];
	if (!tab) throw new Error("Fixture tab is missing");
	return tab;
}

function filePane(layout: WorkspaceState<PaneViewerData>) {
	const pane = firstTab(layout).panes.a;
	if (!pane) throw new Error("Fixture pane is missing");
	return pane;
}

describe("IDE editor context authority", () => {
	it("collects ordinary files from all tabs, deduplicates splits and excludes history", () => {
		const { snapshot } = fixture();
		expect(snapshot().openFiles).toEqual(["/root/a.ts", "/root/b.ts"]);
	});

	it("uses B when activated without focus, then retains B when focusing terminal", () => {
		const { a, b, model, layout, snapshot } = fixture();
		model.capture(
			a.doc,
			view(a.doc.content.kind === "text" ? a.doc.content.value : ""),
			"a",
			true,
		);
		expect(snapshot().activeFile?.selection?.text).toBe("selected");
		layout.activeTabId = "tab-b";
		expect(snapshot().activeFile?.path).toBe(b.doc.absolutePath);
		expect(snapshot().activeFile?.selection).toBeNull();
		layout.activeTabId = "tab-a";
		firstTab(layout).activePaneId = "terminal";
		expect(snapshot().activeFile?.path).toBe(b.doc.absolutePath);
		expect(snapshot().activeFile?.selection).toBeNull();
	});

	it("distinguishes two splits of the same document and keeps selection on ordinary unmount", () => {
		const { a, model, layout, snapshot } = fixture();
		const first = view("before selected after");
		const second = view("before selected after", 0, 6);
		const detachFirst = model.attachEditor(a.doc, first, "a");
		model.attachEditor(a.doc, second, "split");
		first.dom.dispatchEvent(new Event("focusin"));
		expect(snapshot().activeFile?.selection?.text).toBe("selected");
		firstTab(layout).activePaneId = "split";
		expect(snapshot().activeFile?.selection?.text).toBe("before");
		firstTab(layout).activePaneId = "a";
		expect(snapshot().activeFile?.selection?.text).toBe("selected");
		detachFirst();
		firstTab(layout).activePaneId = "terminal";
		expect(snapshot().activeFile?.selection?.text).toBe("selected");
		delete firstTab(layout).panes.a;
		expect(snapshot().activeFile).toBeNull();
	});

	it("selection derives from unsaved buffer and clears on deselection/version/path changes", () => {
		const { a, model, layout, snapshot } = fixture();
		a.doc.setContent("unsaved selected data");
		model.capture(a.doc, view("unsaved selected data", 8, 16), "a", true);
		firstTab(layout).activePaneId = "terminal";
		expect(snapshot().activeFile?.selection?.text).toBe("selected");
		a.doc.setContent("changed selected data");
		expect(snapshot().activeFile?.selection).toBeNull();
		model.capture(a.doc, view("changed selected data", 0, 0), "a", true);
		expect(snapshot().activeFile?.selection).toBeNull();
		a.rename("/root/renamed.ts");
		expect(snapshot().activeFile).toBeNull();
	});

	it("does not reconstruct stale selection from a retained view after version or rename", () => {
		const { a, model, layout, snapshot } = fixture();
		const editor = view("before selected after");
		model.attachEditor(a.doc, editor, "a");
		expect(snapshot().activeFile?.selection?.text).toBe("selected");
		a.doc.setContent("changed selected after");
		expect(snapshot().activeFile?.selection).toBeNull();
		a.rename("/root/renamed.ts");
		filePane(layout).data = {
			filePath: a.doc.absolutePath,
			mode: "editor",
		};
		expect(snapshot().activeFile?.path).toBe(a.doc.absolutePath);
		expect(snapshot().activeFile?.selection).toBeNull();
	});

	it("refuses mismatched buffers/workspaces, missing or binary active files", () => {
		const { a, model, layout, snapshot } = fixture();
		model.capture(a.doc, view("different contents"), "a", true);
		expect(snapshot().activeFile?.selection).toBeNull();
		model.capture(
			document("/root/a.ts", "before selected after", "other").doc,
			view("before selected after"),
			"a",
			true,
		);
		firstTab(layout).activePaneId = "terminal";
		expect(snapshot().activeFile?.selection).toBeNull();
		firstTab(layout).activePaneId = "a";
		a.binary();
		expect(snapshot().activeFile).toBeNull();
		a.orphan();
		expect(snapshot().activeFile).toBeNull();
		filePane(layout).data = {
			filePath: "/root/missing.ts",
			mode: "editor",
		};
		expect(snapshot().activeFile).toBeNull();
	});

	it("keeps JSON-escaped selection inside actual byte limits without sending the whole buffer", () => {
		const { a, model, snapshot } = fixture();
		const text = "\u0001".repeat(10000);
		a.doc.setContent(text);
		model.capture(a.doc, view(text, 0, text.length), "a", true);
		const result = snapshot();
		expect(ideContextSnapshotSchema.safeParse(result).success).toBe(true);
		expect(
			new TextEncoder().encode(JSON.stringify(result)).byteLength,
		).toBeLessThanOrEqual(32 * 1024);
		expect(result.activeFile?.selection?.truncated).toBe(true);
		expect(result.activeFile?.selection?.text.length).toBeLessThan(text.length);
	});

	it("detaching an older view does not unregister a replacement on the same pane", () => {
		const { a, model, snapshot } = fixture();
		const old = view("before selected after");
		const current = view("before selected after", 0, 6);
		const detach = model.attachEditor(a.doc, old, "a");
		model.attachEditor(a.doc, current, "a");
		detach();
		old.dom.dispatchEvent(new Event("focusin"));
		expect(snapshot().activeFile?.selection?.text).toBe("before");
	});
});
