import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { getGitStatusSnapshot } from "../git-status";
import { getGitStatusPartial } from "../git-status-partial";
import {
	GitStatusStore,
	MAX_GIT_BASE_VARIANTS_PER_WORKSPACE,
} from "./git-status-store";

test("LRU pressure preserves real Git status through partial updates, staging and checkout", async () => {
	const repo = await mkdtemp(join(tmpdir(), "git-status-lru-"));
	const git = simpleGit(repo);
	try {
		await git.init();
		await git.raw(["config", "user.email", "test@example.com"]);
		await git.raw(["config", "user.name", "test"]);
		await git.raw(["config", "commit.gpgsign", "false"]);
		await git.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
		await writeFile(join(repo, "tracked.txt"), "base\n");
		await git.add("tracked.txt");
		await git.commit("base");
		for (let i = 0; i < 50; i++) {
			await git.raw(["branch", `base-${i}`]);
			await git.raw(["config", `branch.base-${i}.remote`, "."]);
			await git.raw([
				"config",
				`branch.base-${i}.merge`,
				`refs/heads/base-${i}`,
			]);
		}
		await git.raw(["config", "branch.main.remote", "."]);
		await git.raw(["config", "branch.main.merge", "refs/heads/main"]);
		await git.raw(["checkout", "-b", "work"]);
		await writeFile(join(repo, "tracked.txt"), "work\n");
		await git.add("tracked.txt");
		await git.commit("work");

		const store = new GitStatusStore();
		store.attach("w");
		let fullReads = 0,
			partialReads = 0;
		const fresh = async (baseBranch: string | null) =>
			(
				await getGitStatusSnapshot({
					git,
					worktreePath: repo,
					baseBranch: baseBranch ?? undefined,
				})
			).snapshot;
		const read = (baseBranch: string | null) =>
			store.read({
				workspaceId: "w",
				baseBranch,
				computeFull: async () => {
					fullReads++;
					return fresh(baseBranch);
				},
				computePartial: async (paths) => {
					partialReads++;
					return getGitStatusPartial({ git, worktreePath: repo, paths });
				},
			});
		const common = await read(null);
		for (let i = 0; i < 50; i++) {
			const value = await read(`base-${i}`);
			expect(value.defaultBranch.name).toBe(`base-${i}`);
			expect(value.againstBase.map((file) => file.path)).toEqual([
				"tracked.txt",
			]);
		}
		expect(fullReads).toBe(51);
		for (let i = 50 - MAX_GIT_BASE_VARIANTS_PER_WORKSPACE; i < 50; i++)
			await read(`base-${i}`);
		expect(await read(null)).toBe(common);
		expect(fullReads).toBe(51);

		await writeFile(join(repo, "tracked.txt"), "work\nedit\n");
		store.recordChange("w", [join(repo, "tracked.txt")]);
		expect(await read(null)).toEqual(await fresh(null));
		expect(await read("base-49")).toEqual(await fresh("base-49"));
		expect(partialReads).toBe(2);
		expect(fullReads).toBe(51);
		expect(await read("base-0")).toEqual(await fresh("base-0"));
		expect(fullReads).toBe(52);

		await git.add("tracked.txt");
		store.recordChange("w", undefined);
		expect(await read("base-49")).toEqual(await fresh("base-49"));
		await git.commit("staged edit");
		await git.raw(["checkout", "main"]);
		store.recordChange("w", undefined);
		const checkedOut = await read("base-49");
		expect(checkedOut).toEqual(await fresh("base-49"));
		expect(checkedOut.currentBranch.name).toBe("main");
		expect(checkedOut.againstBase).toEqual([]);
		store.drop("w");
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
}, 120_000);
