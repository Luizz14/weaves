import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = mock(() => {});
mock.module("@tanstack/react-router", () => ({
	useNavigate: () => mockNavigate,
}));

const { cleanup, render } = await import("@testing-library/react");
const React = await import("react");
const { PokedexButton } = await import("./PokedexButton");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

describe("PokedexButton", () => {
	test("renders button and triggers navigation to /settings/pokedex on click", () => {
		const { getByRole } = render(React.createElement(PokedexButton));

		const button = getByRole("button", {
			name: /Abrir Pokédex de Ordem Paranormal/i,
		});
		expect(button).toBeDefined();
		button.click();
		expect(mockNavigate).toHaveBeenCalledWith({ to: "/settings/pokedex" });
	});
});
