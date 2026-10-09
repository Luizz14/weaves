import type { LspCoordinator } from "../coordinator";

const KEEP_ALIVE_MS = 10 * 60_000;
const MAX_IDLE_COORDINATORS = 2;

interface Entry {
	coordinator: LspCoordinator;
	scope: string | null;
	holders: number;
	releasedAt: number;
	timer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();

function scheduleDisposal(key: string, entry: Entry) {
	if (entry.timer) clearTimeout(entry.timer);
	entry.timer = setTimeout(() => disposeCoordinator(key), KEEP_ALIVE_MS);
}

function disposeCoordinator(key: string) {
	const entry = entries.get(key);
	if (!entry) return;
	if (entry.timer) clearTimeout(entry.timer);
	entries.delete(key);
	entry.coordinator.dispose();
}

export function getCoordinator(
	key: string,
	scope: string | null,
	create: () => LspCoordinator,
): LspCoordinator {
	let entry = entries.get(key);
	if (!entry) {
		entry = {
			coordinator: create(),
			scope,
			holders: 0,
			releasedAt: Date.now(),
			timer: null,
		};
		entries.set(key, entry);
		scheduleDisposal(key, entry);
	}
	return entry.coordinator;
}

export function acquireCoordinator(key: string): void {
	const entry = entries.get(key);
	if (!entry) return;
	entry.holders += 1;
	if (entry.timer) clearTimeout(entry.timer);
	entry.timer = null;
}

export function releaseCoordinator(key: string): void {
	const entry = entries.get(key);
	if (!entry) return;
	entry.holders -= 1;
	if (entry.holders > 0) return;
	entry.releasedAt = Date.now();
	scheduleDisposal(key, entry);
	const idle = [...entries]
		.filter(([, candidate]) => candidate.holders <= 0)
		.sort(([, a], [, b]) => a.releasedAt - b.releasedAt);
	while (idle.length > MAX_IDLE_COORDINATORS) {
		const oldest = idle.shift();
		if (oldest) disposeCoordinator(oldest[0]);
	}
}

export function disposeIdleCoordinatorsOutside(scope: string | null): void {
	for (const [key, entry] of [...entries])
		if (entry.holders <= 0 && entry.scope !== scope) disposeCoordinator(key);
}

export function disposeAllCoordinators(): void {
	for (const key of [...entries.keys()]) disposeCoordinator(key);
}

if (import.meta.hot) import.meta.hot.dispose(disposeAllCoordinators);
