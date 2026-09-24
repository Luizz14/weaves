import { expect, test } from "bun:test";
import superjson, { type SuperJSONResult } from "superjson";
import {
	createLegacyProfileExportState,
	exportLegacyProfileStorage,
	type LegacyProfileExportState,
	type LegacyProfileStorage,
} from "./legacy-profile-exporter";
import {
	importLegacyProfileStorage,
	type ProfileMigrationStatus,
	type ProfileMigrationStorage,
	type ProfileMigrationTransport,
	profileMigrationMethods,
} from "./profile-migration";

const MIGRATION_FIXTURE_ID = "00000000-0000-4000-8000-000000000001";
const DELAYED_ACK_FIXTURE_ID = "00000000-0000-4000-8000-000000000002";
const WRONG_ORIGIN_FIXTURE_ID = "00000000-0000-4000-8000-000000000003";

type FakeRequest<T> = {
	result: T;
	error: Error | null;
	[key: string]: unknown;
};

type ExportPayloadForTest = {
	kind: string;
	records?: Array<{ key: unknown; value: unknown }>;
	metadata?: unknown;
};

function createStorage(
	rows: Array<{ key: IDBValidKey; value: unknown }> = Array.from(
		{ length: 130 },
		(_, index) => ({
			key: `cache:${String(index).padStart(3, "0")}`,
			value: {
				"a.b": { at: new Date("2026-09-21T00:00:00.000Z") },
				undefinedValue: undefined,
				bigintValue: BigInt(index),
				map: new Map([["date", new Date("2027-01-01T00:00:00.000Z")]]),
			},
		}),
	),
): LegacyProfileStorage {
	const values = new Map([
		["theme-type", "dark"],
		["router-history", '{"index":1}'],
		["organization-switcher-order-v1", '["org-1"]'],
		["recent-v2-workspaces", '["workspace-1"]'],
		["foreign-widget-cookie", "must-not-export"],
	]);
	const localStorage = {
		get length() {
			return values.size;
		},
		key: (index: number) => [...values.keys()][index] ?? null,
		getItem: (key: string) => values.get(key) ?? null,
	};
	const database = {
		objectStoreNames: { contains: (name: string) => name === "keyval" },
		transaction: () => ({
			objectStore: () => ({
				openCursor: (range?: IDBKeyRange) => {
					const request: FakeRequest<IDBCursorWithValue | null> = {
						result: null,
						error: null,
						onsuccess: null,
					};
					const lowerBound = range?.lower;
					let index =
						lowerBound === undefined
							? 0
							: rows.findIndex((row) => String(row.key) > String(lowerBound));
					if (index < 0) index = rows.length;
					const advance = (): void => {
						const row = rows[index];
						request.result = row
							? ({
									key: row.key,
									value: row.value,
									continue: () => {
										index += 1;
										queueMicrotask(advance);
									},
								} as unknown as IDBCursorWithValue)
							: null;
						(request.onsuccess as ((event: Event) => void) | null)?.(
							new Event("success"),
						);
					};
					queueMicrotask(advance);
					return request as unknown as IDBRequest<IDBCursorWithValue | null>;
				},
			}),
		}),
		close: () => {},
	} as unknown as IDBDatabase;
	const indexedDB = {
		databases: async () => [{ name: "keyval-store", version: 1 }],
		open: () => {
			const request: FakeRequest<IDBDatabase> = {
				result: database,
				error: null,
				onsuccess: null,
			};
			queueMicrotask(() =>
				(request.onsuccess as ((event: Event) => void) | null)?.(
					new Event("success"),
				),
			);
			return request as unknown as IDBOpenDBRequest;
		},
	} as unknown as IDBFactory;
	return {
		localStorage: localStorage as Storage,
		indexedDB,
		location: { origin: "file://", protocol: "file:" } as Location,
		IDBKeyRange: {
			lowerBound: (key: IDBValidKey, open = false) => ({
				lower: key,
				lowerOpen: open,
				upper: "\uffff",
				upperOpen: true,
				includes: (value: IDBValidKey) =>
					typeof key === "string" &&
					typeof value === "string" &&
					value > key &&
					value < "\uffff",
			} satisfies IDBKeyRange),
		},
	} satisfies LegacyProfileStorage;
}

async function drainExport(
	state: LegacyProfileExportState,
	running: Promise<void>,
): Promise<{ payloads: ExportPayloadForTest[]; error: unknown }> {
	const payloads: ExportPayloadForTest[] = [];
	let error: unknown;
	let settled = false;
	void running.then(
		() => {
			settled = true;
		},
		(caught) => {
			error = caught;
			settled = true;
		},
	);
	while (!settled) {
		if (state.chunk !== null) {
			const { sequence, payload } = JSON.parse(state.chunk) as {
				sequence: number;
				payload: ExportPayloadForTest;
			};
			payloads.push(payload);
			state.ack?.(sequence);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	return { payloads, error };
}

test("exports bounded chunks with SuperJSON-compatible IndexedDB records", async () => {
	const state = createLegacyProfileExportState();
	const chunks: Array<{
		kind: string;
		records?: unknown[];
		metadata?: unknown;
	}> = [];
	const running = exportLegacyProfileStorage(
		{
			expectedSourceOrigin: "file://",
			targetOrigin: "https://tauri.localhost",
		},
		createStorage(),
		state,
		MIGRATION_FIXTURE_ID,
	);
	while (!state.done && state.error === null) {
		if (state.chunk !== null) {
			const chunk = JSON.parse(state.chunk) as {
				sequence: number;
				payload: { kind: string; records?: unknown[]; metadata?: unknown };
			};
			expect(new TextEncoder().encode(state.chunk).byteLength).toBeLessThan(
				6 * 1024 * 1024,
			);
			chunks.push(chunk.payload);
			state.ack?.(chunk.sequence);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	await running;

	expect(chunks[0]).toMatchObject({
		kind: "begin",
		metadata: {
			version: 1,
			migrationId: MIGRATION_FIXTURE_ID,
			sourceOrigin: "file://",
			targetOrigin: "https://tauri.localhost",
		},
	});
	const localStorageRecords = chunks
		.filter((chunk) => chunk.kind === "localStorage")
		.flatMap((chunk) => chunk.records ?? []) as Array<{ key: string }>;
	expect(localStorageRecords.map((record) => record.key).sort()).toEqual([
		"organization-switcher-order-v1",
		"recent-v2-workspaces",
		"router-history",
		"theme-type",
	]);
	expect(chunks.at(-1)?.kind).toBe("finish");
	const records = chunks
		.filter((chunk) => chunk.kind === "indexedDb")
		.flatMap((chunk) => chunk.records ?? []) as Array<{ value: unknown }>;
	expect(records).toHaveLength(130);
	const firstRecord = records.at(0);
	if (!firstRecord)
		throw new Error("exporter did not emit an IndexedDB record");
	expect(
		superjson.deserialize<unknown>(firstRecord.value as SuperJSONResult),
	).toEqual({
		"a.b": { at: new Date("2026-09-21T00:00:00.000Z") },
		undefinedValue: undefined,
		bigintValue: 0n,
		map: new Map([["date", new Date("2027-01-01T00:00:00.000Z")]]),
	});

	const previousLocation = globalThis.location;
	Object.defineProperty(globalThis, "location", {
		value: { origin: "https://tauri.localhost" },
		configurable: true,
	});
	try {
		const importedLocalStorage = new Map<string, string>();
		const importedIndexedDb = new Map<string, unknown>();
		const importedStorage: ProfileMigrationStorage = {
			localStorage: {
				getItem: (key) => importedLocalStorage.get(key) ?? null,
				setItem: (key, value) => importedLocalStorage.set(key, value),
			},
			idb: {
				has: async (key) => importedIndexedDb.has(String(key)),
				get: async (key) => importedIndexedDb.get(String(key)),
				set: async (key, value) => {
					importedIndexedDb.set(String(key), value);
				},
			},
		};
		const status: ProfileMigrationStatus = {
			state: "ready",
			migrationId: MIGRATION_FIXTURE_ID,
			sourceOrigin: "file://",
			targetOrigin: "https://tauri.localhost",
			localStorageCount: 4,
			indexedDb: [{ database: "keyval-store", store: "keyval", count: 130 }],
		};
		const transport: ProfileMigrationTransport = {
			invoke: async <T>(method: string, params?: unknown) => {
				if (method === profileMigrationMethods.status) return status as T;
				if (method === profileMigrationMethods.claim) {
					return { ...status, ownerToken: "fixture-owner", generation: 1 } as T;
				}
				if (
					method === profileMigrationMethods.localStorage &&
					typeof params === "object" &&
					params !== null &&
					"cursor" in params
				) {
					return {
						records: chunks
							.filter((chunk) => chunk.kind === "localStorage")
							.flatMap((chunk) => chunk.records ?? []),
						nextCursor: null,
					} as T;
				}
				if (
					method === profileMigrationMethods.indexedDb &&
					typeof params === "object" &&
					params !== null &&
					"cursor" in params
				) {
					return {
						records: chunks
							.filter((chunk) => chunk.kind === "indexedDb")
							.flatMap((chunk) => chunk.records ?? []),
						nextCursor: null,
					} as T;
				}
				return { ...status, state: "complete", ownerToken: null } as T;
			},
		};

		await importLegacyProfileStorage(transport, importedStorage);
		importedStorage.localStorage.setItem("theme-type", "light");
		await importLegacyProfileStorage(transport, importedStorage);

		expect(importedLocalStorage.get("theme-type")).toBe("light");
		expect(importedLocalStorage.get("router-history")).toBe('{"index":1}');
		expect(importedLocalStorage.get("organization-switcher-order-v1")).toBe(
			'["org-1"]',
		);
		expect(importedLocalStorage.get("recent-v2-workspaces")).toBe(
			'["workspace-1"]',
		);
		expect<unknown>(await importedStorage.idb.get("cache:000")).toEqual({
			"a.b": { at: new Date("2026-09-21T00:00:00.000Z") },
			undefinedValue: undefined,
			bigintValue: 0n,
			map: new Map([["date", new Date("2027-01-01T00:00:00.000Z")]]),
		});
	} finally {
		Object.defineProperty(globalThis, "location", {
			value: previousLocation,
			configurable: true,
		});
	}
});

test("skips an oversized React Query cache record and exports later records", async () => {
	const state = createLegacyProfileExportState();
	const running = exportLegacyProfileStorage(
		{
			expectedSourceOrigin: "file://",
			targetOrigin: "https://tauri.localhost",
		},
		createStorage([
			{ key: "cache:before", value: { cached: true } },
			{ key: "superset-rq-cache", value: "x".repeat(5 * 1024 * 1024) },
			{ key: "cache:after", value: { cached: true } },
		]),
		state,
		"00000000-0000-4000-8000-000000000004",
	);
	const { payloads, error } = await drainExport(state, running);

	expect(error).toBeUndefined();
	expect(payloads.at(-1)?.kind).toBe("finish");
	const records = payloads
		.filter((payload) => payload.kind === "indexedDb")
		.flatMap((payload) => payload.records ?? []);
	expect(
		records.map((record) =>
			superjson.deserialize(record.key as SuperJSONResult),
		),
	).toEqual(["cache:before", "cache:after"]);
});

test("still rejects an oversized IndexedDB record outside the refetchable cache", async () => {
	const state = createLegacyProfileExportState();
	const running = exportLegacyProfileStorage(
		{
			expectedSourceOrigin: "file://",
			targetOrigin: "https://tauri.localhost",
		},
		createStorage([
			{ key: "unrelated-large-record", value: "x".repeat(5 * 1024 * 1024) },
		]),
		state,
		"00000000-0000-4000-8000-000000000005",
	);
	const { error } = await drainExport(state, running);

	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toBe(
		"Profile migration record exceeds 4 MiB",
	);
});

test("keeps a chunk pending while its host acknowledgement is delayed", async () => {
	const state = createLegacyProfileExportState();
	const running = exportLegacyProfileStorage(
		{
			expectedSourceOrigin: "file://",
			targetOrigin: "https://tauri.localhost",
		},
		createStorage(),
		state,
		DELAYED_ACK_FIXTURE_ID,
	);
	if (state.chunk === null)
		throw new Error("exporter did not send its first chunk");
	const firstChunk = state.chunk;
	await new Promise<void>((resolve) => setTimeout(resolve, 150));
	expect(state.chunk).toBe(firstChunk);
	const { sequence: firstSequence } = JSON.parse(firstChunk) as {
		sequence: number;
	};
	state.ack?.(firstSequence);

	while (!state.done && state.error === null) {
		if (state.chunk !== null) {
			const { sequence } = JSON.parse(state.chunk) as { sequence: number };
			state.ack?.(sequence);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	await running;
	expect(state.done).toBe(true);
});

test("rejects a profile opened with the wrong renderer origin", async () => {
	await expect(
		exportLegacyProfileStorage(
			{
				expectedSourceOrigin: "http://localhost:5173",
				targetOrigin: "http://127.0.0.1:5173",
				},
				createStorage(),
				createLegacyProfileExportState(),
				WRONG_ORIGIN_FIXTURE_ID,
		),
	).rejects.toThrow(
		"Profile migration source origin does not match its profile",
	);
});
