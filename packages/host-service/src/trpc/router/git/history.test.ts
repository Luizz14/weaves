import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import { historyInput, readHistory, readHistoryRefs } from "./history";
import { buildDiffPatch } from "./utils/diff-patch";
import {
	getChangedFilesForDiff,
	resolveDiffCategoryRefs,
} from "./utils/git-helpers";

describe("Git timeline", () => {
	let directory: string;
	let git: SimpleGit;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "superset-history-"));
		git = simpleGit(directory);
		await git.init();
		await git.addConfig("user.name", "Timeline Author");
		await git.addConfig("user.email", "timeline@example.test");
	});
	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});
	async function commit(message: string, filename = "file.txt") {
		await writeFile(join(directory, filename), message);
		await git.add(filename);
		await git.commit(message);
		return (await git.revparse(["HEAD"])).trim();
	}
	const input = (values: Record<string, unknown> = {}) =>
		historyInput.parse({ workspaceId: "test", ...values });

	test("empty repositories and root commits", async () => {
		expect((await readHistory(git, input())).commits).toEqual([]);
		const root = await commit("Root\n\nA body with tabs\tand newlines.");
		const history = await readHistory(git, input());
		expect(history.commits[0]?.hash).toBe(root);
		expect(history.commits[0]?.parents).toEqual([]);
		expect(history.commits[0]?.body).toContain("tabs\tand newlines");
		const refs = await readHistoryRefs(git);
		expect(
			await git.raw(["diff", "--name-only", refs.emptyTree, root]),
		).toContain("file.txt");
	});
	test("pagination keeps its original tips when a new commit arrives", async () => {
		const first = await commit("First");
		const second = await commit("Second");
		const page = await readHistory(git, input({ limit: 1 }));
		expect(page.commits.map((commit) => commit.hash)).toEqual([second]);
		await commit("Third");
		const next = await readHistory(
			git,
			input({ limit: 1, cursor: page.nextCursor }),
		);
		expect(next.commits.map((commit) => commit.hash)).toEqual([first]);
		expect(next.nextCursor).toBeUndefined();
	});
	test("branch, literal author/message, hash and date filters", async () => {
		const main = await commit("Base");
		await git.branch(["history-base"]);
		const feature = await commit("Literal [feature]");
		expect(
			(
				await readHistory(git, input({ ref: "refs/heads/history-base" }))
			).commits.map((commit) => commit.hash),
		).toEqual([main]);
		expect(
			(
				await readHistory(
					git,
					input({ search: "[FEATURE]", author: "timeline@" }),
				)
			).commits.map((commit) => commit.hash),
		).toEqual([feature]);
		expect(
			(await readHistory(git, input({ search: feature.slice(0, 8) })))
				.commits[0]?.hash,
		).toBe(feature);
		expect(
			(
				await readHistory(
					git,
					input({ search: feature, ref: "refs/heads/history-base" }),
				)
			).commits,
		).toEqual([]);
		expect(
			(await readHistory(git, input({ until: "2000-01-01" }))).commits,
		).toEqual([]);
		expect(
			(await readHistory(git, input({ author: "Unknown" }))).commits,
		).toEqual([]);
		await expect(readHistory(git, input({ ref: "--all" }))).rejects.toThrow(
			"Unknown Git reference",
		);
	});
	test("all branches and merges retain actual parent hashes", async () => {
		const root = await commit("Root");
		await git.checkoutLocalBranch("side");
		const side = await commit("Side", "side.txt");
		await git.checkout(root);
		await git.checkoutLocalBranch("mainline");
		const main = await commit("Main", "main.txt");
		expect(
			(await readHistory(git, input({ ref: "all" }))).commits.map(
				(commit) => commit.hash,
			),
		).toContain(side);
		await git.raw(["merge", "--no-ff", "side", "-m", "Merge side"]);
		const result = await readHistory(git, input());
		expect(result.commits[0]?.parents).toEqual([main, side]);
		expect(result.commits.at(-1)?.hash).toBe(root);
	});

	test("selected commits expose root, renamed and deleted files with their patches", async () => {
		const root = await commit("Original content");
		const { emptyTree } = await readHistoryRefs(git);
		expect(
			(await getChangedFilesForDiff(git, [emptyTree, root]))[0]?.status,
		).toBe("added");
		await git.mv("file.txt", "renamed.txt");
		await git.commit("Rename");
		const renamed = (await readHistory(git, input())).commits[0];
		if (!renamed) throw new Error("Missing rename commit");
		const files = await getChangedFilesForDiff(git, [root, renamed.hash]);
		expect(files[0]?.oldPath).toBe("file.txt");
		expect(files[0]?.path).toBe("renamed.txt");
		const refs = await resolveDiffCategoryRefs(git, "commit", {
			commitHash: renamed.hash,
			fromHash: root,
		});
		const patch = await buildDiffPatch({
			cwd: directory,
			env: process.env,
			category: "commit",
			refs,
			paths: ["file.txt", "renamed.txt"],
		});
		expect(patch).toContain("rename from file.txt");
		expect(patch).toContain("rename to renamed.txt");
		await git.rm("renamed.txt");
		await git.commit("Delete");
		const deleted = (await git.revparse(["HEAD"])).trim();
		expect(
			(await getChangedFilesForDiff(git, [renamed.hash, deleted]))[0]?.status,
		).toBe("deleted");
	});
});
