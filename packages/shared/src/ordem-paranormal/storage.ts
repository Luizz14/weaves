import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { findCharacterByBranch, getOrdemCharacter, getOrdemCharacters } from "./catalog";
import { ordemDiscoveryEmitter } from "./events";
import type { OrdemCharacter } from "./types";

export const OrdemAppearanceSchema = z.object({
	branch: z.string(),
	project: z.string().optional(),
	org: z.string().optional(),
	discoveredAt: z.string(), // ISO 8601
});

export type OrdemAppearance = z.infer<typeof OrdemAppearanceSchema>;

export const OrdemPokedexEntrySchema = z.object({
	slug: z.string(),
	firstDiscoveredAt: z.string(), // ISO 8601
	lastSeenAt: z.string(), // ISO 8601
	timesUsed: z.number().int().min(1),
	appearances: z.array(OrdemAppearanceSchema),
});

export type OrdemPokedexEntry = z.infer<typeof OrdemPokedexEntrySchema>;

export const OrdemPokedexDataSchema = z.object({
	version: z.literal(1),
	entries: z.record(z.string(), OrdemPokedexEntrySchema),
});

export type OrdemPokedexData = z.infer<typeof OrdemPokedexDataSchema>;

export interface OrdemPokedexCardData {
	character: OrdemCharacter;
	isDiscovered: boolean;
	pokedexEntry?: OrdemPokedexEntry;
	isActiveNow: boolean;
	activeBranches: string[];
}

export interface OrdemPokedexSummary {
	totalCharacters: number;
	totalDiscovered: number;
	discoveryPercentage: number;
	cards: OrdemPokedexCardData[];
}

export function getPokedexStoragePath(): string {
	const baseDir = process.env.SUPERSET_HOME_DIR ?? join(homedir(), ".superset");
	return join(baseDir, "ordem_pokedex.json");
}

export function loadPokedex(filePath = getPokedexStoragePath()): OrdemPokedexData {
	try {
		if (!existsSync(filePath)) {
			return { version: 1, entries: {} };
		}
		const content = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(content);
		const validated = OrdemPokedexDataSchema.safeParse(parsed);
		if (validated.success) {
			return validated.data;
		}
	} catch {
		// In case of read/parse failure, return empty pokedex
	}
	return { version: 1, entries: {} };
}

export function savePokedex(
	data: OrdemPokedexData,
	filePath = getPokedexStoragePath(),
): void {
	try {
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
	} catch {
		// Ignore write errors in test or restricted environments
	}
}

export function recordCharacterDiscovery(
	characterSlug: string,
	metadata: { branch: string; project?: string; org?: string },
	filePath = getPokedexStoragePath(),
): OrdemPokedexEntry {
	const data = loadPokedex(filePath);
	const now = new Date().toISOString();
	const existing = data.entries[characterSlug];

	const appearance: OrdemAppearance = {
		branch: metadata.branch,
		project: metadata.project,
		org: metadata.org,
		discoveredAt: now,
	};

	let updatedEntry: OrdemPokedexEntry;
	if (existing) {
		updatedEntry = {
			...existing,
			lastSeenAt: now,
			timesUsed: existing.timesUsed + 1,
			appearances: [appearance, ...existing.appearances].slice(0, 50),
		};
	} else {
		updatedEntry = {
			slug: characterSlug,
			firstDiscoveredAt: now,
			lastSeenAt: now,
			timesUsed: 1,
			appearances: [appearance],
		};
	}

	data.entries[characterSlug] = updatedEntry;
	savePokedex(data, filePath);

	const char = getOrdemCharacter(characterSlug);
	if (char) {
		ordemDiscoveryEmitter.emit("discovery", {
			character: char,
			entry: updatedEntry,
			isFirstDiscovery: !existing,
		});
	}

	return updatedEntry;
}

export function getOrdemPokedexSummary(
	activeBranchNames: string[] = [],
	filePath = getPokedexStoragePath(),
): OrdemPokedexSummary {
	const characters = getOrdemCharacters();
	const pokedex = loadPokedex(filePath);

	const cards: OrdemPokedexCardData[] = characters.map((char) => {
		const entry = pokedex.entries[char.id];
		const isDiscovered = !!entry;

		const normalizedCharId = char.id.toLowerCase().replace(/[^a-z0-9]/g, "");
		const activeBranches = activeBranchNames.filter((branch) => {
			const normalizedBranch = branch.toLowerCase().replace(/[^a-z0-9]/g, "");
			return normalizedBranch.includes(normalizedCharId);
		});

		return {
			character: char,
			isDiscovered,
			pokedexEntry: entry,
			isActiveNow: activeBranches.length > 0,
			activeBranches,
		};
	});

	const totalDiscovered = cards.filter((c) => c.isDiscovered).length;
	const totalCharacters = characters.length;
	const discoveryPercentage =
		totalCharacters > 0 ? Math.round((totalDiscovered / totalCharacters) * 100) : 0;

	return {
		totalCharacters,
		totalDiscovered,
		discoveryPercentage,
		cards,
	};
}

export function recordDiscoveryByBranch(
	branchName: string,
	metadata?: { project?: string; org?: string },
	filePath = getPokedexStoragePath(),
): OrdemPokedexEntry | null {
	const char = findCharacterByBranch(branchName);
	if (!char) return null;
	return recordCharacterDiscovery(
		char.id,
		{ branch: branchName, project: metadata?.project, org: metadata?.org },
		filePath,
	);
}

