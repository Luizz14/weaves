import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { OrdemPokedexSummary } from "@superset/shared/ordem-paranormal";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockSummary: OrdemPokedexSummary = {
	totalCharacters: 43,
	totalDiscovered: 2,
	discoveryPercentage: 5,
	cards: [
		{
			character: {
				id: "guizo",
				name: "Guizo",
				role: "Ocultista",
				element: "Morte",
				category: "personagem",
				season: "Sinais do Outro Lado",
				description: "Ouvinte de sussurros.",
				vd: 110,
			},
			isDiscovered: true,
			isActiveNow: true,
			activeBranches: ["feat/guizo-investigate"],
		},
		{
			character: {
				id: "deus-da-morte",
				name: "Deus da Morte",
				role: "Relíquia de Morte",
				element: "Morte",
				category: "reliquia",
				season: "O Segredo na Floresta",
				description: "O Tempo personificado.",
				teaser: "O lodo negro que consome todos os instantes.",
				vd: 400,
			},
			isDiscovered: false,
			isActiveNow: false,
			activeBranches: [],
		},
	],
};

// Mock electronTrpc
mock.module("renderer/lib/electron-trpc", () => ({
	electronTrpc: {
		ordemParanormal: {
			getSummary: {
				useQuery: () => ({
					data: mockSummary,
					isLoading: false,
					error: null,
				}),
			},
			triggerTestReveal: {
				useMutation: () => ({
					mutate: mock(() => {}),
					isPending: false,
				}),
			},
		},
	},
}));

const { cleanup, render } = await import("@testing-library/react");
const React = await import("react");
const { PokedexPage } = await import("./PokedexPage");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

describe("PokedexPage", () => {
	test("renders header stats, cards and filter bar", () => {
		const { container } = render(React.createElement(PokedexPage));

		expect(container.textContent).toContain("Arquivo Paranormal");
		expect(container.textContent).toContain("Ordo Realitas");
		expect(container.textContent).toContain("Guizo");
		expect(container.textContent).toContain("[CLASSIFICADO]");
		expect(container.textContent).toContain("Testar Carta Pokémon");
	});
});
