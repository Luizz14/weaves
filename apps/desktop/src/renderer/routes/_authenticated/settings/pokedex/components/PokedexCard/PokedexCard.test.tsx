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
const { PokedexCard } = await import("./PokedexCard");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

const mockCardData: OrdemPokedexCardData = {
	character: {
		id: "arthur-cervero",
		name: "Arthur Cervero",
		role: "Especialista",
		element: "Sangue",
		category: "personagem",
		season: "Calamidade",
		description: "Líder e atirador experiente.",
		quote: "Pela Ordem.",
		vd: 120,
	},
	isDiscovered: true,
	pokedexEntry: {
		characterId: "arthur-cervero",
		firstDiscoveredAt: "2026-09-01T00:00:00Z",
		lastUsedAt: "2026-09-20T00:00:00Z",
		timesUsed: 4,
		appearances: [],
	},
	isActiveNow: true,
	activeBranches: ["feat/arthur-cervero-fix"],
};

describe("PokedexCard", () => {
	test("renders unlocked character card with active state and details", () => {
		const { container } = render(
			React.createElement(PokedexCard, {
				cardData: mockCardData,
				onClick: () => {},
			}),
		);

		expect(container.textContent).toContain("Arthur Cervero");
		expect(container.textContent).toContain("Especialista");
		expect(container.textContent).toContain("Ativo");
		expect(container.textContent).toContain("4x");
		expect(container.textContent).toContain("Dossiê →");
	});
});
