import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const closed: string[] = [];

const {
	MAX_SPARES,
	__resetSpareShellsForTesting,
	claimSpareShell,
	computeSpareFingerprint,
	isSpareShell,
	prepareSpareShell,
} = await import("./spare-shells.ts");

const originalInstallSource = process.env.SUPERSET_HOST_INSTALL_SOURCE;

beforeEach(() => {
	closed.length = 0;
	process.env.SUPERSET_HOST_INSTALL_SOURCE = "desktop";
	__resetSpareShellsForTesting(async (id) => {
		closed.push(id);
	});
});

afterEach(() => {
	if (originalInstallSource === undefined) {
		delete process.env.SUPERSET_HOST_INSTALL_SOURCE;
	} else {
		process.env.SUPERSET_HOST_INSTALL_SOURCE = originalInstallSource;
	}
});

const spawnOk = async () => true;

describe("spare shells", () => {
	test("a prepared spare is claimed once by a matching new terminal", async () => {
		const id = await prepareSpareShell({
			workspaceId: "ws",
			themeType: "dark",
			fingerprint: "fp",
			spawn: spawnOk,
		});
		expect(id).not.toBeNull();
		expect(isSpareShell(id as string)).toBe(true);

		const claim = () =>
			claimSpareShell({
				terminalId: id as string,
				workspaceId: "ws",
				themeType: "dark",
				fingerprint: () => "fp",
			});
		expect(await claim()).toBe(true);
		expect(await claim()).toBe(false);
		expect(closed).toEqual([]);
	});

	test("closes a spare whose fingerprint, theme or workspace no longer match", async () => {
		const prepare = () =>
			prepareSpareShell({
				workspaceId: "ws",
				themeType: "dark",
				fingerprint: "fp",
				spawn: spawnOk,
			}) as Promise<string>;

		const stale = await prepare();
		expect(
			await claimSpareShell({
				terminalId: stale,
				workspaceId: "ws",
				themeType: "dark",
				fingerprint: () => "edited-rc",
			}),
		).toBe(false);
		const otherTheme = await prepare();
		expect(
			await claimSpareShell({
				terminalId: otherTheme,
				workspaceId: "ws",
				themeType: "light",
				fingerprint: () => "fp",
			}),
		).toBe(false);

		expect(closed).toEqual([stale, otherTheme]);
		expect(isSpareShell(stale)).toBe(false);
	});

	test("never keeps more than the cap, dropping the oldest", async () => {
		const ids: string[] = [];
		for (let i = 0; i <= MAX_SPARES; i++) {
			ids.push(
				(await prepareSpareShell({
					workspaceId: `ws-${i}`,
					themeType: "dark",
					fingerprint: "fp",
					spawn: spawnOk,
				})) as string,
			);
		}

		expect(closed).toEqual([ids[0] as string]);
		expect(ids.slice(1).every(isSpareShell)).toBe(true);
	});

	test("is off outside desktop hosts and forgets spares that failed to start", async () => {
		expect(
			await prepareSpareShell({
				workspaceId: "ws",
				themeType: "dark",
				fingerprint: "fp",
				spawn: async () => false,
			}),
		).toBeNull();

		process.env.SUPERSET_HOST_INSTALL_SOURCE = "cli";
		const spawn = mock(spawnOk);
		expect(
			await prepareSpareShell({
				workspaceId: "ws",
				themeType: "dark",
				fingerprint: "fp",
				spawn,
			}),
		).toBeNull();
		expect(spawn).not.toHaveBeenCalled();
	});
});

describe("computeSpareFingerprint", () => {
	let home: string;
	let worktree: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "spare-fp-home-"));
		worktree = mkdtempSync(join(tmpdir(), "spare-fp-wt-"));
		mkdirSync(join(worktree, ".git"));
		writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/main\n");
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		rmSync(worktree, { recursive: true, force: true });
	});

	test("changes with the rc files, the checked-out branch and the launch env", () => {
		const fingerprint = (launchEnv = "{}") =>
			computeSpareFingerprint({ worktreePath: worktree, launchEnv, home });
		const initial = fingerprint();

		writeFileSync(join(home, ".zshrc"), "alias ll='ls -l'\n");
		const afterRc = fingerprint();
		expect(afterRc).not.toBe(initial);

		writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/feature\n");
		expect(fingerprint()).not.toBe(afterRc);
		expect(fingerprint('{"CLAUDE_CONFIG_DIR":"x"}')).not.toBe(fingerprint());
	});

	test("follows a linked worktree's gitdir pointer", () => {
		const gitDir = join(worktree, "real-gitdir");
		mkdirSync(gitDir);
		writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/linked\n");
		rmSync(join(worktree, ".git"), { recursive: true, force: true });
		writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
		const before = computeSpareFingerprint({
			worktreePath: worktree,
			launchEnv: "{}",
			home,
		});

		writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/other\n");

		expect(
			computeSpareFingerprint({
				worktreePath: worktree,
				launchEnv: "{}",
				home,
			}),
		).not.toBe(before);
	});
});
