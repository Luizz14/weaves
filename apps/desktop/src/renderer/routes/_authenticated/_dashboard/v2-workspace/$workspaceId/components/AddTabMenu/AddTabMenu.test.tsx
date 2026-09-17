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
test("Codex Chat is available without the Chat v3 flag", () => {
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
					showPresetsBar={false}
					onToggleShowPresetsBar={noop}
				/>
			</DropdownMenuContent>
		</DropdownMenu>,
	);
	expect(view.queryByText("Chat v3")).toBeNull();
	fireEvent.click(view.getByRole("menuitem", { name: "Codex Chat" }));
	expect(open).toHaveBeenCalledTimes(1);
});
