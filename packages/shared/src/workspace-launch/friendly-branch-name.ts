import friendlyWords from "friendly-words";
import { generateOrdemBranchName } from "../ordem-paranormal";

/**
 * Generates a branch name for a workspace.
 * Prioritizes unused character names from Ordem Paranormal RPG.
 * Falls back to friendly-words (predicate + object) if all characters are in use.
 */
export function generateFriendlyBranchName(
	existingNames: string[] = [],
): string {
	return generateOrdemBranchName(existingNames);
}

/**
 * Generates a two-word branch name using the original friendly-words dictionary.
 */
export function generateLegacyFriendlyBranchName(): string {
	const predicates = friendlyWords.predicates as string[];
	const objects = friendlyWords.objects as string[];
	const predicate = predicates[Math.floor(Math.random() * predicates.length)];
	const object = objects[Math.floor(Math.random() * objects.length)];
	return `${predicate}-${object}`;
}

