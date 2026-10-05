import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@superset/ui/tooltip";
import { Profiler } from "react";
import { useWorkspaceSidebarStore } from "renderer/stores/workspace-sidebar-state";

const { SidebarToggle } = await import("./SidebarToggle");
const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
const { act, cleanup, fireEvent, render } = await import(
	"@testing-library/react"
);
const initial = useWorkspaceSidebarStore.getState();
afterEach(() => {
	cleanup();
	useWorkspaceSidebarStore.setState(initial, true);
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

test("sidebar toggle ignores unrelated state and responds to the actual collapse action", () => {
	let commits = 0;
	const view = render(
		<TooltipProvider>
			<Profiler
				id="toggle"
				onRender={() => {
					commits++;
				}}
			>
				<SidebarToggle />
			</Profiler>
		</TooltipProvider>,
	);
	const before = commits;
	act(() => {
		useWorkspaceSidebarStore.getState().setIsResizing(true);
		useWorkspaceSidebarStore
			.getState()
			.toggleProjectCollapsed("unrelated-project");
	});
	expect(commits).toBe(before);
	const collapsed = useWorkspaceSidebarStore.getState().isCollapsed();
	fireEvent.click(view.getByRole("button"));
	expect(useWorkspaceSidebarStore.getState().isCollapsed()).toBe(!collapsed);
	expect(commits).toBeGreaterThan(before);
});
