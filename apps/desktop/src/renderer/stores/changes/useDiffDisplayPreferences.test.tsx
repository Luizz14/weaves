import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useChangesSidebarState } from "renderer/screens/main/components/WorkspaceView/RightSidebar/ChangesView/hooks/useChangesSidebarState";
import { useChangesStore } from "./store";
import { useDiffDisplayPreferences } from "./useDiffDisplayPreferences";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
const { act, cleanup, renderHook } = await import("@testing-library/react");
const initial = useChangesStore.getState();
afterEach(() => {
	cleanup();
	useChangesStore.setState(initial, true);
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

test("diff preferences ignore file selection and other visual state while reacting to their own changes", () => {
	let renders = 0;
	const hook = renderHook(() => {
		renders++;
		return useDiffDisplayPreferences();
	});
	const before = renders;
	act(() =>
		useChangesStore.setState({
			selectedFiles: {},
			activeTab: "review",
			focusMode: !initial.focusMode,
		}),
	);
	expect(renders).toBe(before);
	act(() => hook.result.current.setViewMode("inline"));
	expect(hook.result.current.viewMode).toBe("inline");
	expect(renders).toBeGreaterThan(before);
	act(() => hook.result.current.toggleHideUnchangedRegions());
	expect(hook.result.current.hideUnchangedRegions).toBe(
		!initial.hideUnchangedRegions,
	);
});

test("sidebar observes only its workspace selection and follows workspace changes and clearing", () => {
	let renders = 0;
	const file = {
		path: "a.ts",
		status: "modified" as const,
		additions: 1,
		deletions: 0,
	};
	const hook = renderHook(
		(workspace: string) => {
			renders++;
			return useChangesSidebarState(workspace);
		},
		{ initialProps: "one" },
	);
	const before = renders;
	act(() =>
		useChangesStore.getState().selectFile("two", "/tmp/two/a.ts", file),
	);
	expect(renders).toBe(before);
	act(() =>
		useChangesStore.getState().selectFile("one", "/tmp/one/a.ts", file),
	);
	expect(hook.result.current.selectedFileState?.absolutePath).toBe(
		"/tmp/one/a.ts",
	);
	hook.rerender("two");
	expect(hook.result.current.selectedFileState?.absolutePath).toBe(
		"/tmp/two/a.ts",
	);
	act(() => useChangesStore.getState().selectFile("two", null, null));
	expect(hook.result.current.selectedFileState).toBeNull();
});
