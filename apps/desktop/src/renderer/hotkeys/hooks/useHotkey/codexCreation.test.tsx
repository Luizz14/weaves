import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { useHotkey } = await import("./useHotkey");
const { HOTKEYS, PLATFORM } = await import("../../registry");
const { useHotkeyOverridesStore } = await import(
	"../../stores/hotkeyOverridesStore"
);
const original = useHotkeyOverridesStore.getState().overrides;
afterEach(() => {
	cleanup();
	useHotkeyOverridesStore.setState({ overrides: original });
});
function Probe({ chat, terminal }: { chat: () => void; terminal: () => void }) {
	useHotkey("NEW_CODEX_CHAT", chat);
	useHotkey("NEW_GROUP", terminal);
	return <textarea aria-label="Composer" />;
}
function key(letter: string) {
	return {
		key: letter,
		code: `Key${letter.toUpperCase()}`,
		metaKey: PLATFORM === "mac",
		ctrlKey: PLATFORM !== "mac",
		shiftKey: PLATFORM !== "mac",
	};
}
test("creation shortcuts work inside the composer and dispatch only once", () => {
	useHotkeyOverridesStore.setState({ overrides: {} });
	const chat = mock(() => undefined);
	const terminal = mock(() => undefined);
	const view = render(<Probe chat={chat} terminal={terminal} />);
	fireEvent.keyDown(view.getByRole("textbox"), key("t"));
	expect(chat).toHaveBeenCalledTimes(1);
	expect(terminal).not.toHaveBeenCalled();
	fireEvent.keyDown(view.getByRole("textbox"), key("j"));
	expect(terminal).toHaveBeenCalledTimes(1);
});
test("an explicitly rebound terminal wins over the new chat default", () => {
	useHotkeyOverridesStore.setState({
		overrides: { NEW_GROUP: HOTKEYS.NEW_CODEX_CHAT.key },
	});
	const chat = mock(() => undefined);
	const terminal = mock(() => undefined);
	const view = render(<Probe chat={chat} terminal={terminal} />);
	fireEvent.keyDown(view.getByRole("textbox"), key("t"));
	expect(terminal).toHaveBeenCalledTimes(1);
	expect(chat).not.toHaveBeenCalled();
});
