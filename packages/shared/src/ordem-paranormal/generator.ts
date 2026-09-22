import friendlyWords from "friendly-words";
import { getRandomUnusedOrdemCharacter, ORDEM_CHARACTERS } from "./catalog";

function fallbackFriendlyWord(): string {
	const predicates = friendlyWords.predicates as string[];
	const objects = friendlyWords.objects as string[];
	const predicate = predicates[Math.floor(Math.random() * predicates.length)];
	const object = objects[Math.floor(Math.random() * objects.length)];
	return `${predicate}-${object}`;
}

/**
 * Generates a branch/worktree name based on an Ordem Paranormal character or creature.
 * Prioritizes unused characters from the catalog.
 * If all characters are already in use, appends an incremental counter to a random character or falls back to friendly words.
 */
export function generateOrdemBranchName(existingNames: string[] = []): string {
	const unused = getRandomUnusedOrdemCharacter(existingNames);
	if (unused) {
		return unused.id;
	}

	// If all characters are in use, pick a random character and find the next numeric suffix
	if (ORDEM_CHARACTERS.length > 0) {
		const randomChar =
			ORDEM_CHARACTERS[Math.floor(Math.random() * ORDEM_CHARACTERS.length)];
		if (randomChar) {
			for (let suffix = 2; suffix < 100; suffix++) {
				const candidate = `${randomChar.id}-${suffix}`;
				const alreadyExists = existingNames.some((raw) => {
					const leaf = raw.toLowerCase().trim().split("/").pop();
					return leaf === candidate;
				});
				if (!alreadyExists) return candidate;
			}
		}
	}

	return fallbackFriendlyWord();
}
