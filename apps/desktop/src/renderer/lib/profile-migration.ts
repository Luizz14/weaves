import { get as idbGet, set as idbSet } from "idb-keyval";
import superjson, { type SuperJSONResult } from "superjson";
import { invokeNative } from "./native-bridge";

const BATCH_LIMIT = 128;
const MIGRATION_STATUS = "profile.migration.status";
const MIGRATION_CLAIM = "profile.migration.claim";
const MIGRATION_LOCAL_STORAGE = "profile.migration.localStorageBatch";
const MIGRATION_INDEXED_DB = "profile.migration.indexedDbBatch";
const MIGRATION_COMPLETE = "profile.migration.complete";
const MIGRATION_RELEASE = "profile.migration.release";

export type ProfileMigrationState =
	| "not-needed"
	| "active"
	| "error"
	| "exporting"
	| "waiting"
	| "ready"
	| "complete";

export type ProfileMigrationStore = {
	database: string;
	store: string;
	count: number;
};

export type ProfileMigrationStatus = {
	state: ProfileMigrationState;
	migrationId: string | null;
	sourceOrigin: string | null;
	targetOrigin: string | null;
	localStorageCount: number;
	indexedDb: ProfileMigrationStore[];
	message?: string | null;
	ownerToken?: string | null;
	generation?: number | null;
};

type ProfileLocalStorageRecord = {
	key: string;
	value: string;
};

type ProfileIndexedDbRecord = {
	key: unknown;
	value: unknown;
};

type ProfileBatch<T> = {
	records: T[];
	nextCursor: number | null;
};

export type ProfileMigrationTransport = {
	invoke: <T>(method: string, params?: unknown) => Promise<T>;
};

export type ProfileMigrationStorage = {
	localStorage: Pick<Storage, "getItem" | "setItem">;
	idb: {
		has: (key: IDBValidKey) => Promise<boolean>;
		get: (key: IDBValidKey) => Promise<unknown>;
		set: (key: IDBValidKey, value: unknown) => Promise<void>;
	};
};

const nativeTransport: ProfileMigrationTransport = {
	invoke: (method, params) => invokeNative(method, params),
};

const browserStorage: ProfileMigrationStorage = {
	localStorage,
	idb: {
		has: hasIndexedDbKey,
		get: (key) => idbGet(key),
		set: (key, value) => idbSet(key, value),
	},
};

export async function importLegacyProfileStorage(
	transport: ProfileMigrationTransport = nativeTransport,
	storage: ProfileMigrationStorage = browserStorage,
): Promise<ProfileMigrationStatus> {
	let status = await transport.invoke<ProfileMigrationStatus>(
		MIGRATION_STATUS,
		null,
	);
	assertTargetOrigin(status);
	if (status.state === "not-needed" || status.state === "complete") {
		return status;
	}
	if (status.state === "active") {
		throw new Error(
			status.message ??
				"Legacy Superset storage is still active. Quit the previous Superset instance and retry.",
		);
	}
	if (status.state === "error") {
		throw new Error(status.message ?? "Legacy profile export failed");
	}
	if (status.state === "exporting") {
		status = await waitForSnapshot(transport);
		assertTargetOrigin(status);
		if (status.state === "not-needed" || status.state === "complete") {
			return status;
		}
		if (status.state === "active") {
			throw new Error(
				status.message ??
					"Legacy Superset storage is still active. Quit the previous Superset instance and retry.",
			);
		}
		if (status.state === "error") {
			throw new Error(status.message ?? "Legacy profile export failed");
		}
	}
	if (
		(status.state !== "ready" && status.state !== "waiting") ||
		!status.migrationId
	) {
		throw new Error("Legacy Superset storage snapshot is not ready");
	}

	const migrationId = status.migrationId;
	const claim = await claimMigration(migrationId, status, transport);
	if (claim.state === "complete") return claim;
	if (claim.state !== "ready" || !claim.ownerToken) {
		throw new Error("Legacy Superset storage migration could not be claimed");
	}

	try {
		await importLocalStorage(claim, migrationId, transport, storage);
		for (const store of claim.indexedDb) {
			if (store.database !== "keyval-store" || store.store !== "keyval") {
				continue;
			}
			await importIndexedDb(store, migrationId, transport, storage);
		}

		return transport.invoke<ProfileMigrationStatus>(MIGRATION_COMPLETE, {
			migrationId,
			ownerToken: claim.ownerToken,
		});
	} catch (error) {
		await transport
			.invoke(MIGRATION_RELEASE, {
				migrationId,
				ownerToken: claim.ownerToken,
			})
			.catch(() => {});
		throw error;
	}
}

function assertTargetOrigin(status: ProfileMigrationStatus): void {
	if (status.targetOrigin === null) {
		throw new Error("Profile migration response is missing its target origin");
	}
	const expected = new URL(status.targetOrigin).origin;
	if (expected !== status.targetOrigin) {
		throw new Error("Profile migration target origin is not an exact origin");
	}
	const actual = globalThis.location.origin;
	if (expected !== actual) {
		throw new Error(
			`Legacy profile target origin ${expected} does not match renderer origin ${actual}`,
		);
	}
}

async function waitForSnapshot(
	transport: ProfileMigrationTransport,
): Promise<ProfileMigrationStatus> {
	let status: ProfileMigrationStatus;
	for (let attempt = 0; attempt < 600; attempt += 1) {
		status = await transport.invoke<ProfileMigrationStatus>(
			MIGRATION_STATUS,
			null,
		);
		if (status.state !== "exporting") return status;
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Timed out waiting for the legacy profile snapshot");
}

async function claimMigration(
	migrationId: string,
	initialStatus: ProfileMigrationStatus,
	transport: ProfileMigrationTransport,
): Promise<ProfileMigrationStatus> {
	let status = initialStatus;
	for (let attempt = 0; attempt < 600; attempt += 1) {
		if (status.state === "complete") return status;
		if (status.state === "ready" && status.ownerToken) return status;
		status = await transport.invoke<ProfileMigrationStatus>(MIGRATION_CLAIM, {
			migrationId,
		});
		if (status.state === "complete") return status;
		if (status.state === "ready" && status.ownerToken) return status;
		if (status.state !== "waiting") {
			throw new Error(
				status.message ?? "Legacy profile migration claim failed",
			);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Timed out waiting for another renderer to finish migration");
}

async function importLocalStorage(
	status: ProfileMigrationStatus,
	migrationId: string,
	transport: ProfileMigrationTransport,
	storage: ProfileMigrationStorage,
): Promise<void> {
	let cursor = 0;
	while (true) {
		const batch = await transport.invoke<
			ProfileBatch<ProfileLocalStorageRecord>
		>(MIGRATION_LOCAL_STORAGE, { migrationId, cursor, limit: BATCH_LIMIT });
		for (const record of batch.records) {
			if (storage.localStorage.getItem(record.key) === null) {
				storage.localStorage.setItem(record.key, record.value);
			}
		}
		if (batch.nextCursor === null) return;
		if (batch.nextCursor <= cursor) {
			throw new Error("Legacy localStorage migration cursor did not advance");
		}
		cursor = batch.nextCursor;
		if (cursor > status.localStorageCount + BATCH_LIMIT) {
			throw new Error(
				"Legacy localStorage migration exceeded its record bound",
			);
		}
	}
}

async function importIndexedDb(
	store: ProfileMigrationStore,
	migrationId: string,
	transport: ProfileMigrationTransport,
	storage: ProfileMigrationStorage,
): Promise<void> {
	let cursor = 0;
	while (true) {
		const batch = await transport.invoke<ProfileBatch<ProfileIndexedDbRecord>>(
			MIGRATION_INDEXED_DB,
			{
				migrationId,
				database: store.database,
				store: store.store,
				cursor,
				limit: BATCH_LIMIT,
			},
		);
		for (const record of batch.records) {
			const key = toIndexedDbKey(deserializeSnapshotValue(record.key));
			if (key === null)
				throw new Error("Legacy IndexedDB key is not supported");
			const value = deserializeSnapshotValue(record.value);
			if (!(await storage.idb.has(key))) await storage.idb.set(key, value);
		}
		if (batch.nextCursor === null) return;
		if (batch.nextCursor <= cursor) {
			throw new Error("Legacy IndexedDB migration cursor did not advance");
		}
		cursor = batch.nextCursor;
		if (cursor > store.count + BATCH_LIMIT) {
			throw new Error("Legacy IndexedDB migration exceeded its record bound");
		}
	}
}

function hasIndexedDbKey(key: IDBValidKey): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const openRequest = indexedDB.open("keyval-store");
		openRequest.onerror = () =>
			reject(openRequest.error ?? new Error("IndexedDB open failed"));
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			if (!database.objectStoreNames.contains("keyval")) {
				database.close();
				resolve(false);
				return;
			}
			const keyRequest = database
				.transaction("keyval", "readonly")
				.objectStore("keyval")
				.getKey(key);
			keyRequest.onerror = () => {
				database.close();
				reject(keyRequest.error ?? new Error("IndexedDB key lookup failed"));
			};
			keyRequest.onsuccess = () => {
				database.close();
				resolve(keyRequest.result !== undefined);
			};
		};
	});
}

function deserializeSnapshotValue(value: unknown): unknown {
	if (!isRecord(value) || !("json" in value)) return value;
	return superjson.deserialize(value as unknown as SuperJSONResult);
}

function toIndexedDbKey(value: unknown): IDBValidKey | null {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		value instanceof Date
	)
		return value;
	if (Array.isArray(value)) {
		const keys = value.map(toIndexedDbKey);
		return keys.every((key): key is IDBValidKey => key !== null) ? keys : null;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export const profileMigrationMethods = {
	status: MIGRATION_STATUS,
	claim: MIGRATION_CLAIM,
	localStorage: MIGRATION_LOCAL_STORAGE,
	indexedDb: MIGRATION_INDEXED_DB,
	complete: MIGRATION_COMPLETE,
	release: MIGRATION_RELEASE,
} as const;
