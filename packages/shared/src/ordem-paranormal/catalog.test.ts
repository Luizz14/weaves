import { describe, expect, it } from "bun:test";
import {
	getAllOrdemCharacters,
	getAvailableOrdemCharacters,
	getOrdemCharacter,
	getRandomUnusedOrdemCharacter,
	getWorktreeOrdemStatus,
	isCharacterNameUsed,
	ORDEM_CHARACTERS,
} from "./catalog";
import { generateFriendlyBranchName } from "../workspace-launch";
import { generateOrdemBranchName } from "./generator";
import { ordemCharacterSchema } from "./types";

describe("Ordem Paranormal catalog", () => {
	it("contains valid character definitions matching schema", () => {
		expect(ORDEM_CHARACTERS.length).toBeGreaterThanOrEqual(35);
		for (const character of ORDEM_CHARACTERS) {
			const result = ordemCharacterSchema.safeParse(character);
			expect(result.success).toBe(true);
			// Slugs should be URL and git-safe (lowercase, hyphen-separated, no slashes or spaces)
			expect(character.id).toMatch(/^[a-z0-9-]+$/);
			expect(character.imageUrl.startsWith("https://")).toBe(true);
		}
	});

	it("retrieves a character by ID case-insensitively", () => {
		const arthur = getOrdemCharacter("arthur-cervero");
		expect(arthur).toBeDefined();
		expect(arthur?.name).toBe("Arthur Cervero");

		const jouiUpper = getOrdemCharacter("JOUI-JOUKI");
		expect(jouiUpper).toBeDefined();
		expect(jouiUpper?.name).toBe("Joui Jouki");

		const nonExistent = getOrdemCharacter("unknown-character");
		expect(nonExistent).toBeUndefined();
	});

	it("correctly detects if a character name is in use", () => {
		const existing = [
			"main",
			"luiz/arthur-cervero",
			"feat/joui-jouki-fix",
			"deus-da-morte",
			"other-branch",
		];

		expect(isCharacterNameUsed("arthur-cervero", existing)).toBe(true);
		expect(isCharacterNameUsed("joui-jouki", existing)).toBe(true);
		expect(isCharacterNameUsed("deus-da-morte", existing)).toBe(true);
		expect(isCharacterNameUsed("kaiser", existing)).toBe(false);
		expect(isCharacterNameUsed("thiago-fritz", existing)).toBe(false);
	});

	it("filters available characters excluding used ones", () => {
		const totalCount = getAllOrdemCharacters().length;
		const usedIds = ["arthur-cervero", "joui-jouki"];
		const available = getAvailableOrdemCharacters(usedIds);

		expect(available.length).toBe(totalCount - 2);
		expect(available.some((c) => c.id === "arthur-cervero")).toBe(false);
		expect(available.some((c) => c.id === "joui-jouki")).toBe(false);
		expect(available.some((c) => c.id === "kaiser")).toBe(true);
	});

	it("generates an unused Ordem character name", () => {
		const usedIds = ["arthur-cervero", "joui-jouki"];
		const name = generateOrdemBranchName(usedIds);
		expect(name).toBeString();
		expect(name).not.toBe("arthur-cervero");
		expect(name).not.toBe("joui-jouki");
		expect(ORDEM_CHARACTERS.some((c) => c.id === name)).toBe(true);
	});

	it("handles exhaustion when all characters are used by appending suffix or falling back", () => {
		const allIds = ORDEM_CHARACTERS.map((c) => c.id);
		const name = generateOrdemBranchName(allIds);
		expect(name).toBeString();
		expect(allIds.includes(name)).toBe(false);
	});

	it("provides Pokédex status list for characters", () => {
		const used = ["luiz/arthur-cervero", "kaiser"];
		const statusList = getWorktreeOrdemStatus(used);

		expect(statusList.length).toBe(ORDEM_CHARACTERS.length);

		const arthurStatus = statusList.find((c) => c.id === "arthur-cervero");
		expect(arthurStatus?.isUsed).toBe(true);
		expect(arthurStatus?.activeBranch).toBe("luiz/arthur-cervero");

		const kaiserStatus = statusList.find((c) => c.id === "kaiser");
		expect(kaiserStatus?.isUsed).toBe(true);
		expect(kaiserStatus?.activeBranch).toBe("kaiser");
	});

	it("prioritizes Ordem Paranormal character names in generateFriendlyBranchName", () => {
		const name = generateFriendlyBranchName();
		expect(name).toBeString();
		expect(ORDEM_CHARACTERS.some((c) => c.id === name)).toBe(true);
	});
});
