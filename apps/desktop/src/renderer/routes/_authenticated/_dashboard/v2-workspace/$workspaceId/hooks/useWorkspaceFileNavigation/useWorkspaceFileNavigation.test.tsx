import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createWorkspaceStore } from "@superset/panes";
import type { WorkspaceSidebarTab } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { useRowlessSidebarTabStore } from "../../state/rowlessSidebarTabStore";
import type { FilePaneData, PaneViewerData } from "../../types";
import {
	getWorkspaceSidebarTab,
	setWorkspaceSidebarTab,
} from "../../utils/setWorkspaceSidebarTab";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, renderHook } = await import("@testing-library/react");

const workspaceId = "workspace-1";
const filePath = "/tmp/worktree/src/example.ts";
const rows = new Map<
	string,
	{ sidebarState: { activeTab: WorkspaceSidebarTab } }
>();
const collections = {
	v2WorkspaceLocalState: {
		get: (id: string) => rows.get(id),
		update: (
			id: string,
			mutate: (draft: NonNullable<ReturnType<typeof rows.get>>) => void,
		) => {
			const row = rows.get(id);
			if (row) mutate(row);
		},
	},
} as unknown as Parameters<typeof setWorkspaceSidebarTab>[0];
let sidebarOpen = false;
const setRightSidebarOpen = mock(
	(next: boolean | ((previous: boolean) => boolean)) => {
		sidebarOpen = typeof next === "function" ? next(sidebarOpen) : next;
	},
);
const recordView = mock(() => {});
const revealInFinder = mock(
	(_path: string, _options?: { isDirectory?: boolean }) => {},
);
const workspaceClient = await import("@superset/workspace-client");
mock.module("@superset/workspace-client", () => ({
	...workspaceClient,
	workspaceTrpc: {
		workspace: {
			get: { useQuery: () => ({ data: { worktreePath: "/tmp/worktree" } }) },
		},
	},
}));
mock.module(
	"renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider",
	() => ({
		useWorkspace: () => ({ workspace: { id: workspaceId } }),
	}),
);
mock.module(
	"renderer/routes/_authenticated/providers/CollectionsProvider",
	() => ({
		useCollections: () => collections,
	}),
);
mock.module("../useRecentlyViewedFiles", () => ({
	useRecentlyViewedFiles: () => ({ recentFiles: [], recordView }),
}));
mock.module("../useRevealInFinder", () => ({
	useRevealInFinder: () => revealInFinder,
}));
const { useWorkspaceFileNavigation } = await import(
	"./useWorkspaceFileNavigation"
);

beforeEach(() => {
	rows.clear();
	useRowlessSidebarTabStore.setState({ tabs: {} });
	sidebarOpen = false;
	setRightSidebarOpen.mockClear();
	recordView.mockClear();
	revealInFinder.mockClear();
});
afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

type Operation =
	| "new pane"
	| "existing pane"
	| "new tab"
	| "tree new pane"
	| "tree existing pane"
	| "tree new tab"
	| "pin active file";
const operations: Operation[] = [
	"new pane",
	"existing pane",
	"new tab",
	"tree new pane",
	"tree existing pane",
	"tree new tab",
	"pin active file",
];

describe("file opening selects Files", () => {
	for (const initiallyOpen of [false, true]) {
		for (const savedTab of ["changes", "files", "review"] as const) {
			for (const operation of operations) {
				it(`${operation} from ${savedTab} with sidebar ${initiallyOpen ? "open" : "closed"}`, () => {
					rows.set(workspaceId, { sidebarState: { activeTab: savedTab } });
					sidebarOpen = initiallyOpen;
					const store = createWorkspaceStore<PaneViewerData>();
					const hasExistingFile = !operation.endsWith("new pane");
					if (hasExistingFile) {
						store.getState().addTab({
							panes: [{ kind: "file", data: { filePath, mode: "editor" } }],
						});
					}
					const existing = store.getState().getActivePane();
					if (operation !== "pin active file") {
						store.getState().addTab({
							panes: [{ kind: "terminal", data: { terminalId: "term-1" } }],
						});
					}
					const previousTabCount = store.getState().tabs.length;
					const { result } = renderHook(() =>
						useWorkspaceFileNavigation({ store, setRightSidebarOpen }),
					);
					expect(sidebarOpen).toBe(initiallyOpen);
					expect(getWorkspaceSidebarTab(collections, workspaceId)).toBe(
						savedTab,
					);
					expect(setRightSidebarOpen).not.toHaveBeenCalled();
					act(() => {
						const open =
							operation.startsWith("tree") || operation === "pin active file"
								? result.current.openFilePaneFromTreeClick
								: result.current.openFilePane;
						open("src/example.ts", operation.endsWith("new tab"));
					});
					expect(sidebarOpen).toBe(true);
					expect(getWorkspaceSidebarTab(collections, workspaceId)).toBe(
						"files",
					);
					expect(setRightSidebarOpen).toHaveBeenCalledTimes(1);
					const active = store.getState().getActivePane();
					expect(active?.pane.kind).toBe("file");
					expect((active?.pane.data as FilePaneData).filePath).toBe(filePath);
					if (operation.endsWith("new tab")) {
						expect(store.getState().tabs).toHaveLength(previousTabCount + 1);
						expect(active?.pane.id).not.toBe(existing?.pane.id);
					} else if (hasExistingFile) {
						expect(store.getState().tabs).toHaveLength(previousTabCount);
						expect(active?.pane.id).toBe(existing?.pane.id);
						expect(active?.pane.pinned === true).toBe(
							operation === "pin active file",
						);
					}
				});
			}
		}
	}

	it("switches a rowless session choice only when a file is explicitly opened", () => {
		setWorkspaceSidebarTab(collections, workspaceId, "review");
		const store = createWorkspaceStore<PaneViewerData>();
		const { result } = renderHook(() =>
			useWorkspaceFileNavigation({ store, setRightSidebarOpen }),
		);
		expect(getWorkspaceSidebarTab(collections, workspaceId)).toBe("review");
		act(() => result.current.openFilePane(filePath));
		expect(sidebarOpen).toBe(true);
		expect(getWorkspaceSidebarTab(collections, workspaceId)).toBe("files");
		expect(rows.has(workspaceId)).toBe(false);
	});
});

describe("explicit reveals", () => {
	it("opens Files and refreshes repeated workspace reveal requests", () => {
		rows.set(workspaceId, { sidebarState: { activeTab: "changes" } });
		const store = createWorkspaceStore<PaneViewerData>();
		const { result } = renderHook(() =>
			useWorkspaceFileNavigation({ store, setRightSidebarOpen }),
		);
		act(() => result.current.revealPath(filePath));
		const first = result.current.pendingReveal;
		expect(sidebarOpen).toBe(true);
		expect(getWorkspaceSidebarTab(collections, workspaceId)).toBe("files");
		act(() => result.current.revealPath(filePath));
		expect(result.current.pendingReveal).toEqual(first);
		expect(result.current.pendingReveal).not.toBe(first);
		expect(revealInFinder).not.toHaveBeenCalled();
	});

	it("keeps outside-worktree reveals in Finder without changing the sidebar", () => {
		rows.set(workspaceId, { sidebarState: { activeTab: "review" } });
		const store = createWorkspaceStore<PaneViewerData>();
		const { result } = renderHook(() =>
			useWorkspaceFileNavigation({ store, setRightSidebarOpen }),
		);
		act(() =>
			result.current.revealPath("/tmp/elsewhere", { isDirectory: true }),
		);
		expect(revealInFinder).toHaveBeenCalledWith("/tmp/elsewhere", {
			isDirectory: true,
		});
		expect(setRightSidebarOpen).not.toHaveBeenCalled();
		expect(sidebarOpen).toBe(false);
		expect(getWorkspaceSidebarTab(collections, workspaceId)).toBe("review");
		expect(result.current.pendingReveal).toBeNull();
	});
});
