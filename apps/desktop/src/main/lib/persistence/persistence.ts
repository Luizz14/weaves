import { join } from "node:path";
import { createNodeSQLitePersistence } from "@tanstack/node-db-sqlite-persistence";
import Database from "better-sqlite3";
import {
	ensureSupersetHomeDirExists,
	SUPERSET_HOME_DIR,
} from "../app-environment";

const log = { warn: (...args: unknown[]) => console.warn(...args) };

const VACUUM_RECLAIM_THRESHOLD_BYTES = 64 * 1024 * 1024;

let database: Database.Database | null = null;
let persistenceInstance: ReturnType<typeof createNodeSQLitePersistence> | null =
	null;

function reclaimBloatedDatabaseFile(target: Database.Database): void {
	try {
		target.pragma("wal_checkpoint(TRUNCATE)");
		const pageSize = target.pragma("page_size", { simple: true }) as number;
		const freelistCount = target.pragma("freelist_count", {
			simple: true,
		}) as number;
		if (pageSize * freelistCount < VACUUM_RECLAIM_THRESHOLD_BYTES) {
			return;
		}
		target.exec("VACUUM");
		target.pragma("wal_checkpoint(TRUNCATE)");
	} catch (error) {
		log.warn(
			"[persistence] Failed to reclaim tanstack-db.sqlite space:",
			error,
		);
	}
}

export function initTanstackDbPersistence(): void {
	ensureSupersetHomeDirExists();
	database = new Database(join(SUPERSET_HOME_DIR, "tanstack-db.sqlite"));
	// Crash durability: WAL keeps the main DB file intact across a kill mid-commit
	// (auto-update restart / OS crash) because writes go to a -wal file and the
	// main file is only touched by an atomic checkpoint. Default DELETE journal
	// rewrites the main file in place and can truncate it -> SQLITE_CORRUPT.
	database.pragma("journal_mode = WAL");
	database.pragma("synchronous = NORMAL");
	database.pragma("busy_timeout = 5000");
	reclaimBloatedDatabaseFile(database);
	persistenceInstance = createNodeSQLitePersistence({
		database,
		appliedTxPruneMaxRows: 1_000,
		appliedTxPruneMaxAgeSeconds: 24 * 60 * 60,
	});
}

export function shutdownTanstackDbPersistence(): void {
	persistenceInstance = null;
	database?.close();
	database = null;
}

export function getTanstackDbPersistence(): ReturnType<
	typeof createNodeSQLitePersistence
> {
	if (!persistenceInstance) {
		throw new Error("TanStack DB persistence is not initialized");
	}
	return persistenceInstance;
}
