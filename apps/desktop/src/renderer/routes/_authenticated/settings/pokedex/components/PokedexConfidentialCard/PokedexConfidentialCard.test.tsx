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
const { PokedexConfidentialCard } = await import("./PokedexConfidentialCard");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

const mockCardData: OrdemPokedexCardData = {
	character: {
		id: "gal-soturno",
		name: "Gal Sal",
		role: "Ocultista",
		element: "Morte",
		category: "personagem",
		season: "Desconjuração",
		description: "Um ocultista misterioso.",
		teaser: "Uma máscara branca e o eco dos sinos da Morte.",
		vd: 280,
	},
	isDiscovered: false,
	isActiveNow: false,
	activeBranches: [],
};

describe("PokedexConfidentialCard", () => {
	test("renders classified card with teaser and masked id", () => {
		const { container } = render(
			React.createElement(PokedexConfidentialCard, {
				cardData: mockCardData,
			}),
		);

		expect(container.textContent).toContain("[CLASSIFICADO]");
		expect(container.textContent).toContain("ARQUIVO #GAL-SOTURNO");
		expect(container.textContent).toContain("máscara branca");
	});
});
