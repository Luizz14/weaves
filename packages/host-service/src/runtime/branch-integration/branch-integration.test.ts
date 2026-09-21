import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createGitFixture,
	type GitFixture,
} from "../../../test/helpers/git-fixture";
import {
	cancelIntegration,
	finishIntegration,
	pendingConflictPaths,
	readConflict,
	readIntegrationSession,
	resolveConflict,
	startIntegration,
	withIntegrationRepository,
} from "./branch-integration";

const fixtures: GitFixture[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.dispose();
});
const settings = {
	mergeTargetBranch: "main",
	updateRemote: "origin",
	mergeToMainEnabled: true,
	updateFromMainEnabled: true,
};
async function fixture() {
	const result = await createGitFixture();
	fixtures.push(result);
	return result;
}
async function setup(conflicting = false) {
	const repo = await fixture();
	await repo.git.checkoutLocalBranch("feature");
	await repo.commit(
		"feature",
		conflicting ? { "README.md": "feature\n" } : { "feature.txt": "feature\n" },
	);
	const featureSha = await repo.git.revparse(["HEAD"]);
	await repo.git.checkout("main");
	const workspacePath = join(
		repo.repoPath,
		"..",
		`${repo.repoPath.split("/").pop()}-feature`,
	);
	await repo.git.raw(["worktree", "add", workspacePath, "feature"]);
	const originalDispose = repo.dispose;
	repo.dispose = () => {
		rmSync(workspacePath, { recursive: true, force: true });
		originalDispose();
	};
	if (conflicting)
		await repo.commit("main change", { "README.md": "principal\n" });
	const run = <T>(action: (root: string) => Promise<T>) =>
		withIntegrationRepository(repo.repoPath, action);
	const start = (root: string, kind: "merge" | "update" = "merge") =>
		startIntegration({
			root,
			repoPath: repo.repoPath,
			projectId: "project",
			workspaceId: "workspace",
			workspacePath,
			kind,
			settings,
		});
	return { ...repo, workspacePath, featureSha: featureSha.trim(), run, start };
}
describe("branch integration", () => {
	test("fast-forwards a checked-out main and preserves the feature workspace", async () => {
		const repo = await setup();
		await repo.run(async (root) => {
			const session = await repo.start(root);
			expect((await repo.git.revparse(["main"])).trim()).not.toBe(
				repo.featureSha,
			);
			expect(
				(await finishIntegration(repo.repoPath, root, session, settings)).state,
			).toBe("completed");
			expect((await repo.git.revparse(["main"])).trim()).toBe(repo.featureSha);
			expect(await readFile(join(repo.repoPath, "feature.txt"), "utf8")).toBe(
				"feature\n",
			);
			expect((await repo.git.status()).isClean()).toBe(true);
			expect(
				(await finishIntegration(repo.repoPath, root, session, settings)).state,
			).toBe("completed");
		});
	});
	test("resumes conflicts, resolves the index, and creates a two-parent merge", async () => {
		const repo = await setup(true);
		await repo.run(async (root) => {
			const session = await repo.start(root);
			expect(session.state).toBe("resolving");
			expect((await readIntegrationSession(root))?.id).toBe(session.id);
			const conflict = await readConflict(root, session, "README.md");
			expect(conflict.source?.content).toBe("feature\n");
			expect(conflict.destination?.content).toBe("principal\n");
			await expect(
				finishIntegration(repo.repoPath, root, session, settings),
			).rejects.toThrow("UNRESOLVED");
			await resolveConflict(root, session, "README.md", "manual", "both\n");
			expect(await pendingConflictPaths(root, session)).toEqual([]);
			await finishIntegration(repo.repoPath, root, session, settings);
			expect(await readFile(join(repo.repoPath, "README.md"), "utf8")).toBe(
				"both\n",
			);
			expect(
				(await repo.git.raw(["rev-list", "--parents", "-n", "1", "main"]))
					.trim()
					.split(" "),
			).toHaveLength(3);
		});
	});
	test("cancellation preserves both branches and is idempotent", async () => {
		const repo = await setup(true);
		const before = await repo.git.revparse(["main"]);
		await repo.run(async (root) => {
			const session = await repo.start(root);
			await cancelIntegration(repo.repoPath, root, session);
			await cancelIntegration(repo.repoPath, root, session);
			expect(await repo.git.revparse(["main"])).toBe(before);
			expect((await repo.git.revparse(["feature"])).trim()).toBe(
				repo.featureSha,
			);
		});
	});
	test("rejects dirty destination and disabled operation without a session", async () => {
		const repo = await setup();
		await writeFile(join(repo.repoPath, "local.txt"), "keep");
		await repo.run(async (root) => {
			await expect(repo.start(root)).rejects.toThrow("DIRTY");
			expect(await readIntegrationSession(root)).toBeNull();
			await expect(
				startIntegration({
					root,
					repoPath: repo.repoPath,
					workspacePath: repo.workspacePath,
					projectId: "project",
					workspaceId: "workspace",
					kind: "merge",
					settings: { ...settings, mergeToMainEnabled: false },
				}),
			).rejects.toThrow("DISABLED");
		});
	});
	test("refuses changed destination and retains the resolution", async () => {
		const repo = await setup(true);
		await repo.run(async (root) => {
			const session = await repo.start(root);
			await resolveConflict(root, session, "README.md", "source");
			await repo.commit("another change", { "other.txt": "keep" });
			await expect(
				finishIntegration(repo.repoPath, root, session, settings),
			).rejects.toThrow("BRANCH_CHANGED");
			await cancelIntegration(repo.repoPath, root, session);
			expect(await readFile(join(repo.repoPath, "other.txt"), "utf8")).toBe(
				"keep",
			);
		});
	});
	test("fetches remote main into feature without moving local main or pushing", async () => {
		const remote = await fixture();
		const repo = await setup();
		await repo.git.addRemote("origin", remote.repoPath);
		await remote.git.raw(["fetch", repo.repoPath, "main"]);
		await remote.git.raw(["reset", "--hard", "FETCH_HEAD"]);
		await remote.commit("remote change", { "remote.txt": "fresh" });
		const mainBefore = await repo.git.revparse(["main"]);
		const remoteBefore = await remote.git.revparse(["main"]);
		await repo.run(async (root) => {
			const session = await repo.start(root, "update");
			await finishIntegration(repo.repoPath, root, session, settings);
			expect(
				await readFile(join(repo.workspacePath, "remote.txt"), "utf8"),
			).toBe("fresh");
			expect(await repo.git.revparse(["main"])).toBe(mainBefore);
			expect(await remote.git.revparse(["main"])).toBe(remoteBefore);
		});
	});
	test("fetch failure does not create a session", async () => {
		const repo = await setup();
		await repo.git.addRemote("origin", "/nonexistent/branch-integration-test");
		await repo.run(async (root) => {
			await expect(repo.start(root, "update")).rejects.toThrow("FETCH_FAILED");
			expect(await readIntegrationSession(root)).toBeNull();
		});
	});
});

test("merges into an unchecked-out branch and treats repeated integration as a no-op", async () => {
	const repo = await setup();
	await repo.git.checkoutLocalBranch("other");
	await repo.run(async (root) => {
		const session = await repo.start(root);
		await finishIntegration(repo.repoPath, root, session, settings);
		expect((await repo.git.revparse(["main"])).trim()).toBe(repo.featureSha);
		expect((await repo.git.branchLocal()).current).toBe("other");
		const repeated = await repo.start(root);
		await finishIntegration(repo.repoPath, root, repeated, settings);
		expect((await repo.git.revparse(["main"])).trim()).toBe(repo.featureSha);
	});
}, 30000);

test("binary conflict accepts the original blob without text conversion", async () => {
	const repo = await setup(true);
	await writeFile(join(repo.workspacePath, "README.md"), "source\0bytes");
	await repo.git.raw(["-C", repo.workspacePath, "add", "README.md"]);
	await repo.git.raw([
		"-C",
		repo.workspacePath,
		"commit",
		"-m",
		"binary feature",
	]);
	await repo.commit("binary main", { "README.md": "destination\0bytes" });
	await repo.run(async (root) => {
		const session = await repo.start(root);
		expect(
			(await readConflict(root, session, "README.md")).source?.editable,
		).toBe(false);
		await resolveConflict(root, session, "README.md", "source");
		await finishIntegration(repo.repoPath, root, session, settings);
		expect(await readFile(join(repo.repoPath, "README.md"), "utf8")).toBe(
			"source\0bytes",
		);
	});
}, 30000);

test("rejects arbitrary conflict paths and concurrent attempts", async () => {
	const repo = await setup(true);
	await repo.run(async (root) => {
		const session = await repo.start(root);
		await expect(readConflict(root, session, "../outside")).rejects.toThrow(
			"INVALID_CONFLICT",
		);
		await expect(
			resolveConflict(
				root,
				session,
				"README.md/../../outside",
				"manual",
				"bad",
			),
		).rejects.toThrow("INVALID_CONFLICT");
		await expect(repo.start(root)).rejects.toThrow("SESSION_EXISTS");
		await expect(repo.run(async () => undefined)).rejects.toThrow("BUSY");
		expect(
			await withIntegrationRepository(
				repo.repoPath,
				async (readRoot) => (await readIntegrationSession(readRoot))?.id,
				true,
			),
		).toBe(session.id);
		await cancelIntegration(repo.repoPath, root, session);
	});
}, 30000);

test("modify/delete conflict can preserve the deletion", async () => {
	const repo = await setup(true);
	await repo.git.raw(["rm", "README.md"]);
	await repo.git.commit("delete on main");
	await repo.run(async (root) => {
		const session = await repo.start(root);
		expect(
			(await readConflict(root, session, "README.md")).destination?.exists,
		).toBe(false);
		await resolveConflict(root, session, "README.md", "destination");
		await finishIntegration(repo.repoPath, root, session, settings);
		expect(
			(
				await repo.git.raw(["ls-tree", "--name-only", "main", "README.md"])
			).trim(),
		).toBe("");
	});
}, 30000);

test("rename/rename conflicts expose each path and retain the chosen destination name", async () => {
	const repo = await setup();
	await repo.git.raw([
		"-C",
		repo.workspacePath,
		"mv",
		"README.md",
		"feature-name.md",
	]);
	await repo.git.raw([
		"-C",
		repo.workspacePath,
		"commit",
		"-m",
		"rename feature",
	]);
	await repo.git.raw(["mv", "README.md", "main-name.md"]);
	await repo.git.commit("rename main");
	await repo.run(async (root) => {
		const session = await repo.start(root);
		expect(session.state).toBe("resolving");
		for (const path of await pendingConflictPaths(root, session)) {
			await resolveConflict(root, session, path, "destination");
		}
		await finishIntegration(repo.repoPath, root, session, settings);
		const names = await repo.git.raw(["ls-tree", "--name-only", "main"]);
		expect(names).toContain("main-name.md");
		expect(names).not.toContain("feature-name.md");
	});
}, 30000);

test("changed settings and dirty source during resolution block completion but allow cancellation", async () => {
	const repo = await setup(true);
	await repo.run(async (root) => {
		const session = await repo.start(root);
		await resolveConflict(root, session, "README.md", "source");
		await expect(
			finishIntegration(repo.repoPath, root, session, {
				...settings,
				mergeTargetBranch: "other",
			}),
		).rejects.toThrow("CONFIG_CHANGED");
		await writeFile(join(repo.workspacePath, "pending.txt"), "keep");
		await expect(
			finishIntegration(repo.repoPath, root, session, settings),
		).rejects.toThrow("DIRTY");
		await cancelIntegration(repo.repoPath, root, session);
		expect(
			await readFile(join(repo.workspacePath, "pending.txt"), "utf8"),
		).toBe("keep");
	});
}, 30000);
