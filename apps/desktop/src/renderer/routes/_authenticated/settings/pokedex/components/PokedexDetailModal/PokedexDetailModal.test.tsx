import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { OrdemPokedexCardData } from "@superset/shared/ordem-paranormal";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { cleanup, render } = await import("@testing-library/react");
const React = await import("react");
const { PokedexDetailModal } = await import("./PokedexDetailModal");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

const mockCardData: OrdemPokedexCardData = {
	character: {
		id: "joui-jouki",
		name: "Joui Jouki",
		role: "Combatente",
		element: "Sangue",
		category: "personagem",
		season: "O Segredo na Floresta",
		description: "Ginasta e combatente destemido.",
		quote: "Pela equipe!",
		vd: 140,
	},
	isDiscovered: true,
	pokedexEntry: {
		characterId: "joui-jouki",
		firstDiscoveredAt: "2026-09-01T00:00:00Z",
		lastUsedAt: "2026-09-21T00:00:00Z",
		timesUsed: 2,
		appearances: [
			{
				branch: "feat/joui-jouki-strike",
				discoveredAt: "2026-09-21T00:00:00Z",
				project: "weaves",
			},
		],
	},
	isActiveNow: true,
	activeBranches: ["feat/joui-jouki-strike"],
};

describe("PokedexDetailModal", () => {
	test("renders modal with character details and history when open", () => {
		render(
			React.createElement(PokedexDetailModal, {
				cardData: mockCardData,
				isOpen: true,
				onClose: () => {},
			}),
		);

		expect(document.body.textContent).toContain("Joui Jouki");
		expect(document.body.textContent).toContain("Pela equipe!");
		expect(document.body.textContent).toContain("feat/joui-jouki-strike");
		expect(document.body.textContent).toContain("VD 140");
	});

	test("returns null when cardData is null", () => {
		const { container } = render(
			React.createElement(PokedexDetailModal, {
				cardData: null,
				isOpen: true,
				onClose: () => {},
			}),
		);

		expect(container.innerHTML).toBe("");
	});
});
