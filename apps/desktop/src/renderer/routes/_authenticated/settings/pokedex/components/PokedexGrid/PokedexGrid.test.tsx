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
const { PokedexGrid } = await import("./PokedexGrid");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

const cards: OrdemPokedexCardData[] = [
	{
		character: {
			id: "arthur-cervero",
			name: "Arthur Cervero",
			role: "Especialista",
			element: "Sangue",
			category: "personagem",
			season: "Calamidade",
			description: "Líder e atirador experiente.",
		},
		isDiscovered: true,
		isActiveNow: false,
		activeBranches: [],
	},
	{
		character: {
			id: "anfitriao",
			name: "O Anfitrião",
			role: "Relíquia de Energia",
			element: "Energia",
			category: "reliquia",
			season: "Desconjuração",
			description: "O Caos encarnado.",
			teaser: "Um show de auditório ensurdecedor.",
		},
		isDiscovered: false,
		isActiveNow: false,
		activeBranches: [],
	},
];

describe("PokedexGrid", () => {
	test("renders both discovered and confidential cards", () => {
		const { container } = render(
			React.createElement(PokedexGrid, {
				cards,
				onSelectCard: () => {},
			}),
		);

		expect(container.textContent).toContain("Arthur Cervero");
		expect(container.textContent).toContain("[CLASSIFICADO]");
	});

	test("renders empty state when no cards match", () => {
		const { container } = render(
			React.createElement(PokedexGrid, {
				cards: [],
				onSelectCard: () => {},
			}),
		);

		expect(container.textContent).toContain(
			"Nenhum registro paranormal encontrado",
		);
	});
});
