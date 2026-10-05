import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import simpleGit, { type SimpleGit } from "simple-git";
import type { HostServiceContext } from "../../../types";
import { gitRouter } from "./git";
import { gitStatusStore } from "./utils/git-status-store";

/**
 * Real repos on a real filesystem — only the db lookup and the git factory are
 * stubbed, because `discardChanges` is otherwise pure git + fs.
 */
function createCaller(worktreePath: string | undefined) {
	const ctx = {
		isAuthenticated: true,
		db: {
			query: {
				workspaces: {
					findFirst: () => ({ sync: () => ({ worktreePath }) }),
				},
			},
		},
		git: async (path: string) => simpleGit(path),
	} as unknown as HostServiceContext;
	return gitRouter.createCaller(ctx);
}

async function initRepo(path: string): Promise<SimpleGit> {
	const git = simpleGit(path);
	await git.init();
	await git.raw(["config", "user.email", "test@example.com"]);
	await git.raw(["config", "user.name", "test"]);
	await git.raw(["config", "commit.gpgsign", "false"]);
	await git.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
	return git;
}

describe("gitRouter.discardChanges", () => {
	let root: string;
	let repo: string;
	let git: SimpleGit;

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "superset-discard-"));
		repo = join(root, "worktree");
		await mkdir(repo);
		git = await initRepo(repo);
		await writeFile(join(repo, "tracked.txt"), "committed\n");
		await git.raw(["add", "--", "tracked.txt"]);
		await git.raw(["commit", "-m", "init"]);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("discarding a partially staged file preserves the index", async () => {
		await writeFile(join(repo, "tracked.txt"), "staged content\n");
		await git.add("tracked.txt");
		const stagedBefore = await git.raw(["diff", "--cached"]);
		await writeFile(join(repo, "tracked.txt"), "unstaged content\n");
		await createCaller(repo).discardChanges({
			workspaceId: "ws",
			filePath: "tracked.txt",
		});
		expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe(
			"staged content\n",
		);
		expect(await git.raw(["diff", "--cached"])).toBe(stagedBefore);
		expect(await git.raw(["diff"])).toBe("");
	});
	test("discarding edits to a staged new file keeps the staged addition", async () => {
		await writeFile(join(repo, "new.txt"), "staged new\n");
		await git.add("new.txt");
		const stagedBefore = await git.raw(["diff", "--cached"]);
		await writeFile(join(repo, "new.txt"), "unstaged new\n");
		await createCaller(repo).discardChanges({
			workspaceId: "ws",
			filePath: "new.txt",
		});
		expect(await readFile(join(repo, "new.txt"), "utf8")).toBe("staged new\n");
		expect(await git.raw(["diff", "--cached"])).toBe(stagedBefore);
	});
	test("discarding edits after a staged rename preserves the rename", async () => {
		await git.raw(["mv", "tracked.txt", "renamed.txt"]);
		const stagedBefore = await git.raw(["diff", "--cached"]);
		const indexed = await git.raw(["show", ":renamed.txt"]);
		await writeFile(join(repo, "renamed.txt"), "unstaged rename edit\n");
		await createCaller(repo).discardChanges({
			workspaceId: "ws",
			filePath: "renamed.txt",
		});
		expect(await readFile(join(repo, "renamed.txt"), "utf8")).toBe(indexed);
		expect(await git.raw(["diff", "--cached"])).toBe(stagedBefore);
	});

	test("unmerged files reject discard without changing the conflict or index", async () => {
		await git.checkoutLocalBranch("side");
		await writeFile(join(repo, "tracked.txt"), "side change\n");
		await git.add("tracked.txt");
		await git.raw(["commit", "-m", "side"]);
		await git.checkout("main");
		await writeFile(join(repo, "tracked.txt"), "main change\n");
		await git.add("tracked.txt");
		await git.raw(["commit", "-m", "main"]);
		await git.raw(["merge", "side"]).catch(() => "");
		const conflict = await readFile(join(repo, "tracked.txt"), "utf8");
		const index = await git.raw(["ls-files", "-u"]);
		expect(index.length).toBeGreaterThan(0);
		await expect(
			createCaller(repo).discardChanges({
				workspaceId: "ws",
				filePath: "tracked.txt",
			}),
		).rejects.toThrow();
		expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe(conflict);
		expect(await git.raw(["ls-files", "-u"])).toBe(index);
	});

	test("forces the next status read to walk in full", async () => {
		const workspaceId = "ws-discard-invalidates";
		gitStatusStore.attach(workspaceId);
		gitStatusStore.recordChange(workspaceId, []);
		let fullWalks = 0;
		const read = () =>
			gitStatusStore.read({
				workspaceId,
				baseBranch: null,
				computeFull: async () => {
					fullWalks++;
					return {
						currentBranch: null as never,
						defaultBranch: null as never,
						againstBase: [],
						staged: [],
						unstaged: [],
						ignoredPaths: [],
					};
				},
				computePartial: async (paths) => ({ paths, unstaged: [] }),
			});
		try {
			await read();
			await read();
			expect(fullWalks).toBe(1);

			await writeFile(join(repo, "tracked.txt"), "edited\n");
			await createCaller(repo).discardChanges({
				workspaceId,
				filePath: "tracked.txt",
			});
			await read();
			expect(fullWalks).toBe(2);
		} finally {
			gitStatusStore.drop(workspaceId);
		}
	});

	test("discards an untracked directory", async () => {
		// An embedded git repository is the case that reaches `discardChanges`
		// as a directory: git reports it as a single `dir/` entry even under
		// `-uall`, because it will not descend into another repository.
		const embedded = join(repo, "embedded");
		await mkdir(embedded);
		await initRepo(embedded);
		await writeFile(join(embedded, "notes.txt"), "scratch\n");

		expect((await git.status()).not_added).toContain("embedded/");

		const result = await createCaller(repo).discardChanges({
			workspaceId: "ws-1",
			filePath: "embedded/",
		});

		expect(result).toEqual({ success: true });
		expect(existsSync(embedded)).toBe(false);
		expect((await git.status()).not_added).toEqual([]);
	});

	test("discards an untracked file", async () => {
		await writeFile(join(repo, "scratch.txt"), "temporary\n");

		const result = await createCaller(repo).discardChanges({
			workspaceId: "ws-1",
			filePath: "scratch.txt",
		});

		expect(result).toEqual({ success: true });
		expect(existsSync(join(repo, "scratch.txt"))).toBe(false);
	});

	test("restores a tracked file from the index instead of deleting it", async () => {
		await writeFile(join(repo, "tracked.txt"), "local edit\n");

		await createCaller(repo).discardChanges({
			workspaceId: "ws-1",
			filePath: "tracked.txt",
		});

		expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe(
			"committed\n",
		);
	});

	describe("containment", () => {
		let outsideFile: string;

		beforeEach(async () => {
			const outside = join(root, "outside");
			await mkdir(outside);
			outsideFile = join(outside, "precious.txt");
			await writeFile(outsideFile, "not ours to delete\n");
		});

		for (const filePath of [
			"../outside",
			"../outside/precious.txt",
			"embedded/../../outside",
			"./../../outside",
		]) {
			test(`rejects ${filePath} before deleting anything`, async () => {
				await expect(
					createCaller(repo).discardChanges({
						workspaceId: "ws-1",
						filePath,
					}),
				).rejects.toMatchObject({ code: "BAD_REQUEST" });
				expect(existsSync(outsideFile)).toBe(true);
			});
		}

		test("rejects an absolute path before deleting anything", async () => {
			await expect(
				createCaller(repo).discardChanges({
					workspaceId: "ws-1",
					filePath: join(root, "outside"),
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(existsSync(outsideFile)).toBe(true);
		});

		test("rejects the worktree root", async () => {
			await expect(
				createCaller(repo).discardChanges({
					workspaceId: "ws-1",
					filePath: ".",
				}),
			).rejects.toBeInstanceOf(TRPCError);
			expect(existsSync(join(repo, "tracked.txt"))).toBe(true);
		});

		test("unlinks an untracked symlink without following it", async () => {
			await symlink(join(root, "outside"), join(repo, "link"));

			await createCaller(repo).discardChanges({
				workspaceId: "ws-1",
				filePath: "link",
			});

			expect(existsSync(join(repo, "link"))).toBe(false);
			expect(existsSync(outsideFile)).toBe(true);
		});
	});
});

describe("gitRouter.discardAllStaged", () => {
	let root: string;
	let repo: string;
	let git: SimpleGit;

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "superset-discard-staged-"));
		repo = join(root, "worktree");
		await mkdir(repo);
		git = await initRepo(repo);
		await writeFile(join(repo, "tracked.txt"), "committed\n");
		await git.raw(["add", "--", "tracked.txt"]);
		await git.raw(["commit", "-m", "init"]);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("discards a staged directory entry", async () => {
		// A staged gitlink (embedded repo added to the index) is the staged-as-
		// added path that is a directory on disk.
		const embedded = join(repo, "embedded");
		await mkdir(embedded);
		const embeddedGit = await initRepo(embedded);
		await writeFile(join(embedded, "notes.txt"), "scratch\n");
		await embeddedGit.raw(["add", "--", "notes.txt"]);
		await embeddedGit.raw(["commit", "-m", "embedded"]);
		await git.raw(["add", "--", "embedded"]);

		const result = await createCaller(repo).discardAllStaged({
			workspaceId: "ws-1",
		});

		expect(result).toEqual({ success: true });
		expect(existsSync(embedded)).toBe(false);
	});

	test("discards a staged file", async () => {
		await writeFile(join(repo, "added.txt"), "new\n");
		await git.raw(["add", "--", "added.txt"]);

		await createCaller(repo).discardAllStaged({ workspaceId: "ws-1" });

		expect(existsSync(join(repo, "added.txt"))).toBe(false);
		expect((await git.status()).staged).toEqual([]);
	});
});
