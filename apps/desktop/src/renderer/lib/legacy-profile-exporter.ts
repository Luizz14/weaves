import superjson from "superjson";
import { PERSISTED_KEY_REGISTRY } from "./persisted-keys/persisted-key-registry.test-data";

const BATCH_LIMIT = 128;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_BYTES = 6 * 1024 * 1024;
const REFETCHABLE_OVERSIZED_INDEXED_DB_KEYS = new Set<IDBValidKey>([
	"superset-rq-cache",
]);
const persistedKeyPatterns = PERSISTED_KEY_REGISTRY.flatMap(
	([, keys]) => keys,
).map(
	(pattern) =>
		new RegExp(
			`^${pattern
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
				.replaceAll("\\*", ".*")
				.replaceAll("<store>", "[^:]+")}$`,
		),
);

export type LegacyProfileExportConfig = {
	expectedSourceOrigin: string;
	targetOrigin: string;
};

export type LegacyProfileExportState = {
	sequence: number;
	chunk: string | null;
	done: boolean;
	error: string | null;
	ack: ((sequence: number) => void) | null;
};

export type LegacyProfileExporterWindow = Window & {
	__SUPERSET_LEGACY_EXPORT_CONFIG__?: LegacyProfileExportConfig;
	__SUPERSET_LEGACY_EXPORT_STATE__?: LegacyProfileExportState;
};

export type LegacyProfileStorage = Pick<
	Window,
	"localStorage" | "indexedDB"
> & {
	location: Pick<Location, "origin" | "protocol">;
	IDBKeyRange: Pick<typeof IDBKeyRange, "lowerBound">;
};

type LocalStorageRecord = { key: string; value: string };
type IndexedDbRecord = { key: unknown; value: unknown };

type ExportPayload = {
	kind: "begin" | "localStorage" | "indexedDb" | "finish";
	metadata?: {
		version: 1;
		migrationId: string;
		sourceOrigin: string;
		targetOrigin: string;
	};
	records?: LocalStorageRecord[] | IndexedDbRecord[];
	database?: string;
	store?: string;
};

export function createLegacyProfileExportState(): LegacyProfileExportState {
	return {
		sequence: 0,
		chunk: null,
		done: false,
		error: null,
		ack: null,
	};
}

export async function exportLegacyProfileStorage(
	config: LegacyProfileExportConfig,
	storage: LegacyProfileStorage,
	state: LegacyProfileExportState,
	migrationId: string = globalThis.crypto.randomUUID(),
): Promise<void> {
	if (new URL(config.targetOrigin).origin !== config.targetOrigin) {
		throw new Error("Profile migration target origin must be an exact origin");
	}
	const sourceOrigin =
		storage.location.protocol === "file:" ? "file://" : storage.location.origin;
	if (sourceOrigin !== config.expectedSourceOrigin) {
		throw new Error(
			"Profile migration source origin does not match its profile",
		);
	}

	const send = async (payload: ExportPayload): Promise<void> => {
		const sequence = ++state.sequence;
		const serialized = JSON.stringify({
			sequence,
			payload: { ...payload, migrationId },
		});
		if (byteLength(serialized) > MAX_BATCH_BYTES) {
			throw new Error("Profile migration chunk exceeds the byte limit");
		}
		await new Promise<void>((resolve, reject) => {
			state.chunk = serialized;
			state.ack = (receivedSequence) => {
				if (receivedSequence !== sequence) return;
				state.chunk = null;
				state.ack = null;
				resolve();
			};
			if (state.error) reject(new Error(state.error));
		});
	};

	const sendRecords = async <T extends LocalStorageRecord | IndexedDbRecord>(
		kind: "localStorage" | "indexedDb",
		records: T[],
		extra: Pick<ExportPayload, "database" | "store"> = {},
	): Promise<void> => {
		let batch: T[] = [];
		for (const record of records) {
			const candidate = [...batch, record];
			const payload: ExportPayload = { kind, ...extra, records: candidate };
			const serialized = JSON.stringify({
				sequence: state.sequence + 1,
				payload: { ...payload, migrationId },
			});
			const size = byteLength(JSON.stringify(record));
			if (size > MAX_RECORD_BYTES) {
				throw new Error("Profile migration record exceeds 4 MiB");
			}
			if (
				batch.length > 0 &&
				(candidate.length > BATCH_LIMIT ||
					byteLength(serialized) > MAX_BATCH_BYTES)
			) {
				await send({ kind, ...extra, records: batch });
				batch = [record];
				const singleRecord = JSON.stringify({
					sequence: state.sequence + 1,
					payload: {
						kind,
						...extra,
						records: batch,
						migrationId,
					},
				});
				if (byteLength(singleRecord) > MAX_BATCH_BYTES) {
					throw new Error("Profile migration record cannot fit in a chunk");
				}
				continue;
			}
			if (
				candidate.length > BATCH_LIMIT ||
				byteLength(serialized) > MAX_BATCH_BYTES
			) {
				throw new Error("Profile migration record cannot fit in a chunk");
			}
			batch = candidate;
		}
		if (batch.length > 0) await send({ kind, ...extra, records: batch });
	};

	await send({
		kind: "begin",
		metadata: {
			version: 1,
			migrationId,
			sourceOrigin,
			targetOrigin: config.targetOrigin,
		},
	});

	let localBatch: LocalStorageRecord[] = [];
	for (let index = 0; index < storage.localStorage.length; index += 1) {
		const key = storage.localStorage.key(index);
		if (key === null) continue;
		if (!persistedKeyPatterns.some((pattern) => pattern.test(key))) continue;
		const value = storage.localStorage.getItem(key);
		if (value === null) {
			throw new Error(`Profile localStorage value disappeared for ${key}`);
		}
		localBatch.push({ key, value });
		if (localBatch.length >= BATCH_LIMIT) {
			await sendRecords("localStorage", localBatch);
			localBatch = [];
		}
	}
	if (localBatch.length > 0) await sendRecords("localStorage", localBatch);

	if (typeof storage.indexedDB.databases !== "function") {
		throw new Error("This runtime cannot enumerate legacy IndexedDB databases");
	}
	const databases = await storage.indexedDB.databases();
	for (const description of databases) {
		if (description.name !== "keyval-store") continue;
		const database = await openDatabase(storage.indexedDB, description.name);
		if (!database.objectStoreNames.contains("keyval")) {
			database.close();
			continue;
		}

		let lastKey: IDBValidKey | undefined;
		while (true) {
			const batch = await readIndexedDbBatch(
				database,
				storage.IDBKeyRange,
				lastKey,
			);
			if (batch.records.length > 0) {
				await sendRecords("indexedDb", batch.records, {
					database: description.name,
					store: "keyval",
				});
			}
			if (batch.done) break;
			if (batch.lastKey === undefined) {
				throw new Error("Legacy IndexedDB cursor failed to advance");
			}
			lastKey = batch.lastKey;
		}
		database.close();
	}

	await send({ kind: "finish" });
	state.done = true;
}

async function readIndexedDbBatch(
	database: IDBDatabase,
	keyRange: Pick<typeof IDBKeyRange, "lowerBound">,
	lastKey: IDBValidKey | undefined,
): Promise<{
	records: IndexedDbRecord[];
	lastKey?: IDBValidKey;
	done: boolean;
}> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction("keyval", "readonly");
		const store = transaction.objectStore("keyval");
		const range =
			lastKey === undefined ? undefined : keyRange.lowerBound(lastKey, true);
		const request = store.openCursor(range);
		const records: IndexedDbRecord[] = [];
		let recordBytes = 0;
		let batchLastKey: IDBValidKey | undefined;
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB cursor failed"));
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve({ records, lastKey: batchLastKey, done: true });
				return;
			}
			try {
				const record: IndexedDbRecord = {
					key: superjson.serialize(cursor.key),
					value: superjson.serialize(cursor.value),
				};
				const size = byteLength(JSON.stringify(record));
				if (size > MAX_RECORD_BYTES) {
					if (REFETCHABLE_OVERSIZED_INDEXED_DB_KEYS.has(cursor.key)) {
						batchLastKey = cursor.key;
						cursor.continue();
						return;
					}
					throw new Error("Profile migration record exceeds 4 MiB");
				}
				if (
					records.length > 0 &&
					(records.length >= BATCH_LIMIT ||
						recordBytes + size > MAX_BATCH_BYTES)
				) {
					resolve({ records, lastKey: batchLastKey, done: false });
					return;
				}
				records.push(record);
				recordBytes += size;
				batchLastKey = cursor.key;
				if (records.length >= BATCH_LIMIT || recordBytes >= MAX_BATCH_BYTES) {
					resolve({ records, lastKey: batchLastKey, done: false });
					return;
				}
				cursor.continue();
			} catch (error) {
				reject(error);
			}
		};
	});
}

function openDatabase(
	indexedDB: IDBFactory,
	name: string | undefined,
): Promise<IDBDatabase> {
	if (!name) return Promise.reject(new Error("IndexedDB database has no name"));
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB open failed"));
	});
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function startFromWindow(): void {
	const exporterWindow = window as LegacyProfileExporterWindow;
	const config = exporterWindow.__SUPERSET_LEGACY_EXPORT_CONFIG__;
	const search = new URLSearchParams(window.location?.search ?? "");
	const targetOrigin = config?.targetOrigin ?? search.get("targetOrigin");
	const expectedSourceOrigin =
		config?.expectedSourceOrigin ?? search.get("sourceOrigin");
	if (!targetOrigin || !expectedSourceOrigin) return;
	const state = createLegacyProfileExportState();
	exporterWindow.__SUPERSET_LEGACY_EXPORT_STATE__ = state;
	void exportLegacyProfileStorage(
		{ expectedSourceOrigin, targetOrigin },
		{
			location: window.location,
			localStorage: window.localStorage,
			indexedDB: window.indexedDB,
			IDBKeyRange,
		},
		state,
	).catch((error: unknown) => {
		state.error = error instanceof Error ? error.message : String(error);
	});
}

declare global {
	interface Window {
		__SUPERSET_LEGACY_EXPORT_CONFIG__?: LegacyProfileExportConfig;
		__SUPERSET_LEGACY_EXPORT_STATE__?: LegacyProfileExportState;
	}
}

if (typeof window !== "undefined") startFromWindow();
