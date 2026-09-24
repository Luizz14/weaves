import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { workspaces } from "../../../../db/schema";

const sessionsRoot = mkdtempSync(join(tmpdir(), "create-session-test-"));

mock.module("../shared/session-paths", () => ({
	defaultSessionsRoot: () => sessionsRoot,
	safeResolveSessionPath: (folderName: string) => {
		const sessionPath = resolve(sessionsRoot, folderName);
		if (
			sessionPath === sessionsRoot ||
			!sessionPath.startsWith(sessionsRoot + sep)
		) {
			throw new Error(`Invalid test session name: ${folderName}`);
		}
		return sessionPath;
	},
	isInsideSessionsRoot: (path: string) => {
		const resolved = resolve(path);
		return resolved !== sessionsRoot && resolved.startsWith(sessionsRoot + sep);
	},
}));

const { createTestHost } = await import(
	"../../../../../test/helpers/createTestHost"
);
type TestHost = Awaited<ReturnType<typeof createTestHost>>;

const gitIdentity = {
	GIT_AUTHOR_NAME: "Test Runner",
	GIT_AUTHOR_EMAIL: "test@superset.sh",
	GIT_COMMITTER_NAME: "Test Runner",
	GIT_COMMITTER_EMAIL: "test@superset.sh",
} as const;
const previousGitIdentity = new Map<
	keyof typeof gitIdentity,
	string | undefined
>();

describe("workspaces.createSession naming", () => {
	let host: TestHost | undefined;

	beforeAll(() => {
		for (const [key, value] of Object.entries(gitIdentity) as Array<
			[keyof typeof gitIdentity, string]
		>) {
			previousGitIdentity.set(key, process.env[key]);
			process.env[key] = value;
		}
	});

	beforeEach(async () => {
		host = await createTestHost();
	});

	afterEach(async () => {
		await host?.dispose();
		host = undefined;
	});

	afterAll(() => {
		for (const [key, value] of previousGitIdentity) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		mock.restore();
		rmSync(sessionsRoot, { recursive: true, force: true });
	});

	test("trims the explicit display name and sanitizes its folder", async () => {
		if (!host) throw new Error("Test host was not initialized");
		const name = " My Scratch Space! ";
		const result = await host.trpc.workspaces.createSession.mutate({ name });
		const row = host.db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, result.workspace.id))
			.get();

		expect(result.workspace.name).toBe(name.trim());
		expect(row?.name).toBe(name.trim());
		expect(dirname(row?.worktreePath ?? "")).toBe(sessionsRoot);
		expect(basename(row?.worktreePath ?? "")).toBe("my-scratch-space");
	});

	test("uses the generated folder name when the display name is omitted", async () => {
		if (!host) throw new Error("Test host was not initialized");
		const result = await host.trpc.workspaces.createSession.mutate({});
		const row = host.db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, result.workspace.id))
			.get();
		const folderName = basename(row?.worktreePath ?? "");

		expect(folderName).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		expect(dirname(row?.worktreePath ?? "")).toBe(sessionsRoot);
		expect(row?.name).toBe(folderName);
	});

	test("returns the existing workspace on an idempotent retry", async () => {
		if (!host) throw new Error("Test host was not initialized");
		const id = "1ea729f8-1f3b-4a75-bdcc-209c6b734ab3";
		const first = await host.trpc.workspaces.createSession.mutate({
			id,
			name: "Original Session",
		});
		const foldersBeforeRetry = readdirSync(sessionsRoot).sort();
		const retry = await host.trpc.workspaces.createSession.mutate({
			id,
			name: "Changed Retry Name",
		});

		expect(retry.workspace.id).toBe(first.workspace.id);
		expect(retry.workspace.name).toBe("Original Session");
		expect(readdirSync(sessionsRoot).sort()).toEqual(foldersBeforeRetry);
	});
});
