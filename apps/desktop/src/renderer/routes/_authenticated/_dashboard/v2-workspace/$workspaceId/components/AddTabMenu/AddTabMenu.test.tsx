import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DropdownMenu, DropdownMenuContent } from "@superset/ui/dropdown-menu";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, fireEvent, cleanup } = await import("@testing-library/react");
mock.module("renderer/components/HotkeyMenuShortcut", () => ({
	HotkeyMenuShortcut: () => null,
}));
const { AddTabMenu } = await import("./AddTabMenu");
afterEach(cleanup);
test.each([
	"Codex Chat",
	"Git History",
])("%s is available without the Chat v3 flag", (name) => {
	const open = mock(() => undefined);
	const noop = () => undefined;
	const view = render(
		<DropdownMenu open>
			<DropdownMenuContent>
				<AddTabMenu
					onAddCodexChat={open}
					onAddTerminal={noop}
					onAddBrowser={noop}
					onAddChanges={noop}
					onAddGitHistory={open}
					showPresetsBar={false}
					onToggleShowPresetsBar={noop}
				/>
			</DropdownMenuContent>
		</DropdownMenu>,
	);
	expect(view.queryByText("Chat v3")).toBeNull();
	fireEvent.click(view.getByRole("menuitem", { name }));
	expect(open).toHaveBeenCalledTimes(1);
});
