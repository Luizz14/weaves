import rawCharacters from "./characters.json";
import {
	type OrdemCharacter,
	type OrdemCharacterStatus,
	ordemCharacterSchema,
} from "./types";

export const ORDEM_CHARACTERS: OrdemCharacter[] = (
	rawCharacters as unknown[]
).map((entry) => ordemCharacterSchema.parse(entry));

export function getAllOrdemCharacters(): OrdemCharacter[] {
	return ORDEM_CHARACTERS;
}

export function getOrdemCharacter(id: string): OrdemCharacter | undefined {
	const normalized = id.toLowerCase().trim();
	return ORDEM_CHARACTERS.find((c) => c.id.toLowerCase() === normalized);
}

/**
 * Checks if a character's id/slug is already used in a list of branch names or paths.
 * Handles branches with author or feature prefixes (e.g. "luiz/arthur-cervero", "feat/arthur-cervero")
 * and potential numerical suffixes (e.g. "arthur-cervero-1").
 */
export function isCharacterNameUsed(
	characterId: string,
	existingNames: string[] = [],
): boolean {
	const target = characterId.toLowerCase().trim();
	return existingNames.some((raw) => {
		const clean = raw.toLowerCase().trim();
		const leaf = clean.includes("/") ? clean.split("/").pop()! : clean;
		return (
			leaf === target ||
			leaf.startsWith(`${target}-`) ||
			leaf.endsWith(`-${target}`)
		);
	});
}

/**
 * Returns all Ordem characters that have NOT yet been used in the given branch/worktree names.
 */
export function getAvailableOrdemCharacters(
	existingNames: string[] = [],
): OrdemCharacter[] {
	return ORDEM_CHARACTERS.filter(
		(char) => !isCharacterNameUsed(char.id, existingNames),
	);
}

/**
 * Randomly picks one unused Ordem character, or null if all characters are in use.
 */
export function getRandomUnusedOrdemCharacter(
	existingNames: string[] = [],
): OrdemCharacter | null {
	const available = getAvailableOrdemCharacters(existingNames);
	if (available.length === 0) return null;
	const index = Math.floor(Math.random() * available.length);
	return available[index] ?? null;
}

/**
 * Returns the status of all characters in the catalog with whether they are active in existing worktrees.
 * Ready for the upcoming Pokédex interface.
 */
export function getWorktreeOrdemStatus(
	existingNames: string[] = [],
): OrdemCharacterStatus[] {
	return ORDEM_CHARACTERS.map((char) => {
		const isUsed = isCharacterNameUsed(char.id, existingNames);
		const matched = existingNames.find((raw) => {
			const clean = raw.toLowerCase().trim();
			const leaf = clean.includes("/") ? clean.split("/").pop()! : clean;
			return (
				leaf === char.id.toLowerCase() ||
				leaf.startsWith(`${char.id.toLowerCase()}-`)
			);
		});
		return {
			...char,
			isUsed,
			activeBranch: matched ?? null,
		};
	});
}

export const getOrdemCharacters = getAllOrdemCharacters;

/**
 * Finds an Ordem character by branch name or leaf name.
 */
export function findCharacterByBranch(branchName: string): OrdemCharacter | undefined {
	const clean = branchName.toLowerCase().trim();
	const leaf = clean.includes("/") ? clean.split("/").pop()! : clean;
	return ORDEM_CHARACTERS.find((char) => {
		const target = char.id.toLowerCase();
		return leaf === target || leaf.startsWith(`${target}-`) || leaf.endsWith(`-${target}`);
	});
}

