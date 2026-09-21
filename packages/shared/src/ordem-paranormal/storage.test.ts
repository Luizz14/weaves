import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getOrdemPokedexSummary,
	loadPokedex,
	recordCharacterDiscovery,
	recordDiscoveryByBranch,
} from "./storage";

describe("Ordem Paranormal Pokédex Storage", () => {
	const testDbPath = join(tmpdir(), `superset-test-pokedex-${Date.now()}.json`);

	beforeEach(() => {
		if (existsSync(testDbPath)) {
			rmSync(testDbPath);
		}
	});

	afterEach(() => {
		if (existsSync(testDbPath)) {
			rmSync(testDbPath);
		}
	});

	it("returns empty pokedex when file does not exist", () => {
		const data = loadPokedex(testDbPath);
		expect(data.version).toBe(1);
		expect(Object.keys(data.entries).length).toBe(0);
	});

	it("records a new character discovery and persists it", () => {
		const entry = recordCharacterDiscovery(
			"arthur-cervero",
			{ branch: "arthur-cervero", project: "project-1", org: "org-1" },
			testDbPath,
		);

		expect(entry.slug).toBe("arthur-cervero");
		expect(entry.timesUsed).toBe(1);
		expect(entry.appearances.length).toBe(1);
		expect(entry.appearances[0]?.branch).toBe("arthur-cervero");
		expect(entry.appearances[0]?.project).toBe("project-1");
		expect(entry.appearances[0]?.org).toBe("org-1");

		const reloaded = loadPokedex(testDbPath);
		expect(reloaded.entries["arthur-cervero"]).toBeDefined();
		expect(reloaded.entries["arthur-cervero"]?.timesUsed).toBe(1);
	});

	it("increments usage count on subsequent discoveries across different orgs", () => {
		recordCharacterDiscovery(
			"joui-jouki",
			{ branch: "feat/joui-jouki", project: "proj-a", org: "org-acme" },
			testDbPath,
		);

		const second = recordCharacterDiscovery(
			"joui-jouki",
			{ branch: "joui-jouki-fix", project: "proj-b", org: "org-other" },
			testDbPath,
		);

		expect(second.timesUsed).toBe(2);
		expect(second.appearances.length).toBe(2);
		expect(second.appearances[0]?.org).toBe("org-other");
		expect(second.appearances[1]?.org).toBe("org-acme");
	});

	it("records discovery automatically from branch name", () => {
		const entry = recordDiscoveryByBranch(
			"origin/kaiser-terminal-work",
			{ project: "superset", org: "global" },
			testDbPath,
		);

		expect(entry).not.toBeNull();
		expect(entry?.slug).toBe("kaiser");
		expect(entry?.timesUsed).toBe(1);
	});

	it("computes pokedex summary with discovery percentage and active status", () => {
		recordCharacterDiscovery(
			"arthur-cervero",
			{ branch: "arthur-cervero" },
			testDbPath,
		);
		recordCharacterDiscovery(
			"joui-jouki",
			{ branch: "joui-jouki" },
			testDbPath,
		);

		const summary = getOrdemPokedexSummary(
			["arthur-cervero-active"],
			testDbPath,
		);

		expect(summary.totalCharacters).toBeGreaterThanOrEqual(35);
		expect(summary.totalDiscovered).toBe(2);
		expect(summary.discoveryPercentage).toBeGreaterThan(0);

		const arthurCard = summary.cards.find(
			(c) => c.character.id === "arthur-cervero",
		);
		expect(arthurCard).toBeDefined();
		expect(arthurCard?.isDiscovered).toBe(true);
		expect(arthurCard?.isActiveNow).toBe(true);
		expect(arthurCard?.activeBranches).toContain("arthur-cervero-active");

		const jouiCard = summary.cards.find((c) => c.character.id === "joui-jouki");
		expect(jouiCard).toBeDefined();
		expect(jouiCard?.isDiscovered).toBe(true);
		expect(jouiCard?.isActiveNow).toBe(false);

		const kaiserCard = summary.cards.find((c) => c.character.id === "kaiser");
		expect(kaiserCard).toBeDefined();
		expect(kaiserCard?.isDiscovered).toBe(false);
	});

	it("does not duplicate appearances or increment timesUsed when called for the same branch", () => {
		const first = recordCharacterDiscovery(
			"rubius",
			{ branch: "rubius-patch-1", project: "proj-1" },
			testDbPath,
		);
		expect(first.timesUsed).toBe(1);
		expect(first.appearances.length).toBe(1);

		const second = recordCharacterDiscovery(
			"rubius",
			{ branch: "rubius-patch-1", project: "proj-1" },
			testDbPath,
		);
		expect(second.timesUsed).toBe(1);
		expect(second.appearances.length).toBe(1);
	});
});
