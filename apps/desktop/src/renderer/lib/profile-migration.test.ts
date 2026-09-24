import { expect, test } from "bun:test";
import superjson from "superjson";
import {
	importLegacyProfileStorage,
	type ProfileMigrationStatus,
	type ProfileMigrationStorage,
	type ProfileMigrationTransport,
	profileMigrationMethods,
} from "./profile-migration";

Object.defineProperty(globalThis, "location", {
	value: { origin: "http://localhost" },
	configurable: true,
});

function storageFixture(): ProfileMigrationStorage {
	const local = new Map<string, string>();
	const idb = new Map<string, unknown>();
	return {
		localStorage: {
			getItem: (key) => local.get(key) ?? null,
			setItem: (key, value) => local.set(key, value),
		},
		idb: {
			has: async (key) => idb.has(String(key)),
			get: async (key) => idb.get(String(key)),
			set: async (key, value) => {
				idb.set(String(key), value);
			},
		},
	};
}

test("imports allowlisted localStorage and typed keyval records before ack", async () => {
	const calls: Array<{ method: string; params: unknown }> = [];
	const status: ProfileMigrationStatus = {
		state: "ready",
		migrationId: "migration-1",
		sourceOrigin: "file://",
		targetOrigin: globalThis.location.origin,
		localStorageCount: 2,
		indexedDb: [{ database: "keyval-store", store: "keyval", count: 4 }],
	};
	const transport: ProfileMigrationTransport = {
		invoke: async <T>(method: string, params?: unknown) => {
			calls.push({ method, params });
			if (method === profileMigrationMethods.status) return status as T;
			if (method === profileMigrationMethods.claim) {
				return { ...status, ownerToken: "owner-1", generation: 1 } as T;
			}
			if (method === profileMigrationMethods.localStorage) {
				return {
					records: [
						{ key: "router-history", value: '{"index":1}' },
						{ key: "v2-sidebar-projects-org", value: '{"pinned":true}' },
					],
					nextCursor: null,
				} as T;
			}
			if (method === profileMigrationMethods.indexedDb) {
				const legacyValue = {
					"a.b": { at: new Date("2026-09-21T00:00:00.000Z") },
					u: undefined,
					b: 123n,
					map: new Map([["date", new Date("2027-01-01T00:00:00.000Z")]]),
				};
				return {
					records: [
						{
							key: "host-workspaces:v1:org:machine",
							value: superjson.serialize(legacyValue),
						},
						{
							key: superjson.serialize(new Date("2026-09-21T00:00:00.000Z")),
							value: superjson.serialize({ cache: true }),
						},
						{
							key: superjson.serialize("legacy-undefined"),
							value: superjson.serialize(undefined),
						},
						{
							key: superjson.serialize("existing-undefined"),
							value: superjson.serialize("legacy-value"),
						},
					],
					nextCursor: null,
				} as T;
			}
			return { ...status, state: "complete", ownerToken: null } as T;
		},
	};
	const storage = storageFixture();
	await storage.idb.set("existing-undefined", undefined);
	const result = await importLegacyProfileStorage(transport, storage);

	expect(result.state).toBe("complete");
	expect(calls.at(-1)?.method).toBe(profileMigrationMethods.complete);
	expect(await storage.idb.get("host-workspaces:v1:org:machine")).toEqual({
		"a.b": { at: new Date("2026-09-21T00:00:00.000Z") },
		u: undefined,
		b: 123n,
		map: new Map([["date", new Date("2027-01-01T00:00:00.000Z")]]),
	});
	expect(await storage.idb.get(new Date("2026-09-21T00:00:00.000Z"))).toEqual({
		cache: true,
	});
	expect(await storage.idb.has("legacy-undefined")).toBe(true);
	expect(await storage.idb.get("legacy-undefined")).toBeUndefined();
	expect(await storage.idb.get("existing-undefined")).toBeUndefined();
});

test("does not acknowledge an active or failed migration", async () => {
	const calls: string[] = [];
	const transport: ProfileMigrationTransport = {
		invoke: async <T>(method: string) => {
			calls.push(method);
			return {
				state: "active",
				migrationId: null,
				sourceOrigin: "file://",
				targetOrigin: globalThis.location.origin,
				localStorageCount: 0,
				indexedDb: [],
				message: "Stop the previous Superset instance first",
			} as T;
		},
	};

	await expect(
		importLegacyProfileStorage(transport, storageFixture()),
	).rejects.toThrow("Stop the previous Superset instance first");
	expect(calls).toEqual([profileMigrationMethods.status]);
});

test("does not import a profile from another runtime origin", async () => {
	const transport: ProfileMigrationTransport = {
		invoke: async <T>() =>
			({
				state: "not-needed",
				migrationId: null,
				sourceOrigin: "file://",
				targetOrigin: "http://127.0.0.1:5173",
				localStorageCount: 0,
				indexedDb: [],
			}) satisfies ProfileMigrationStatus as T,
	};

	await expect(
		importLegacyProfileStorage(transport, storageFixture()),
	).rejects.toThrow(
		"Legacy profile target origin http://127.0.0.1:5173 does not match renderer origin http://localhost",
	);
});

test("waits for an exporter instead of treating it as an active legacy app", async () => {
	const calls: string[] = [];
	let statusCalls = 0;
	const ready: ProfileMigrationStatus = {
		state: "ready",
		migrationId: "migration-2",
		sourceOrigin: "file://",
		targetOrigin: globalThis.location.origin,
		localStorageCount: 0,
		indexedDb: [],
	};
	const transport: ProfileMigrationTransport = {
		invoke: async <T>(method: string) => {
			calls.push(method);
			if (method === profileMigrationMethods.status) {
				statusCalls += 1;
				return (
					statusCalls === 1
						? { ...ready, state: "exporting", migrationId: null }
						: ready
				) as T;
			}
			if (method === profileMigrationMethods.claim) {
				return { ...ready, ownerToken: "owner-2", generation: 1 } as T;
			}
			if (method === profileMigrationMethods.localStorage) {
				return { records: [], nextCursor: null } as T;
			}
			return { ...ready, state: "complete" } as T;
		},
	};

	const result = await importLegacyProfileStorage(transport, storageFixture());
	expect(result.state).toBe("complete");
	expect(calls).toEqual([
		profileMigrationMethods.status,
		profileMigrationMethods.status,
		profileMigrationMethods.claim,
		profileMigrationMethods.localStorage,
		profileMigrationMethods.complete,
	]);
});
