import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { WorkspaceFilesystemManager } from "../runtime/filesystem";
import { initTerminalBaseEnv } from "../terminal/env";
import { FlutterSessions } from "./sessions";

async function waitUntil(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("Condition timed out");
}
test("session lifecycle rejects duplicate starts and stale IDs, reloads and shuts down", async () => {
	const root = await mkdtemp(join(tmpdir(), "superset-flutter-session-"));
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });
	const hostDb = db as unknown as HostDb;
	db.insert(schema.projects).values({ id: "project", repoPath: root }).run();
	db.insert(schema.workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			name: "test",
			branch: "main",
			worktreePath: root,
		})
		.run();
	const filesystem = new WorkspaceFilesystemManager({ db: hostDb });
	const manager = new FlutterSessions({ db: hostDb, filesystem });
	try {
		await mkdir(join(root, "lib"));
		await mkdir(join(root, "bin"));
		await writeFile(
			join(root, "pubspec.yaml"),
			"name: fixture\ndependencies:\n  flutter:\n    sdk: flutter\n",
		);
		await writeFile(join(root, "lib/main.dart"), "void main() {}\n");
		await writeFile(
			join(root, "bin/flutter"),
			`#!/bin/sh\nexec '${process.execPath}' '${resolve(import.meta.dir, "fixtures/adapter.cts")}' "$@"\n`,
		);
		await chmod(join(root, "bin/flutter"), 0o755);
		await writeFile(join(root, "bin/dart"), "#!/bin/sh\nexit 0\n");
		await chmod(join(root, "bin/dart"), 0o755);
		initTerminalBaseEnv({
			PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
		});
		const [profile] = await manager.profiles("workspace");
		if (!profile) throw new Error("No profile");
		await expect(
			manager.start({
				workspaceId: "workspace",
				profileId: profile.id,
				hash: "stale",
				deviceId: "fixture-device",
			}),
		).rejects.toThrow("changed");
		const session = await manager.start({
			workspaceId: "workspace",
			profileId: profile.id,
			hash: profile.hash,
			deviceId: "fixture-device",
		});
		await waitUntil(() => manager.snapshot("workspace")?.phase === "running");
		await expect(
			manager.start({
				workspaceId: "workspace",
				profileId: profile.id,
				hash: profile.hash,
				deviceId: "fixture-device",
			}),
		).rejects.toThrow("Stop the current");
		await expect(
			manager.control("workspace", "stale", "reload"),
		).rejects.toThrow("no longer exists");
		await manager.control("workspace", session.id, "reload");
		await waitUntil(
			() =>
				!!manager.snapshot("workspace")?.output.includes("Reloaded fixture"),
		);
		await manager.stop("workspace", session.id);
		expect(manager.snapshot("workspace")?.phase).toBe("exited");
		const replacement = await manager.start({
			workspaceId: "workspace",
			profileId: profile.id,
			hash: profile.hash,
			deviceId: "fixture-device",
		});
		expect(replacement.id).not.toBe(session.id);
		await waitUntil(() => manager.snapshot("workspace")?.phase === "running");
		await manager.stopWorkspace("workspace");
		expect(manager.snapshot("workspace")).toBeNull();
		await manager.dispose();
		await expect(
			manager.start({
				workspaceId: "workspace",
				profileId: profile.id,
				hash: profile.hash,
				deviceId: "fixture-device",
			}),
		).rejects.toThrow("shutting down");
	} finally {
		await manager.dispose();
		sqlite.close();
		await rm(root, { recursive: true, force: true });
	}
}, 10000);
