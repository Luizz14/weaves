import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getHostInstallSource } from "../install-source.ts";
import { getDaemonClient } from "./daemon-client-singleton.ts";

/**
 * Pre-started shells for new terminals. A user's login shell takes hundreds of
 * milliseconds to reach its prompt (nvm, compinit, prompt frameworks); a spare
 * is a pty-daemon session started ahead of time under the id the next new
 * terminal will use, so attaching to it adopts a shell already at its prompt.
 *
 * A spare has no session row, sockets, port scan or events until it is
 * claimed. Anything that would make it differ from a freshly spawned shell
 * (rc files, the branch its prompt shows, the theme it was started with) is
 * captured in a fingerprint; a spare whose fingerprint no longer matches is
 * discarded and the terminal spawns normally.
 */

export const SPARE_TTL_MS = 10 * 60_000;
export const MAX_SPARES = 3;
const SWEEP_INTERVAL_MS = 30_000;

interface SpareShell {
	workspaceId: string;
	themeType: string | undefined;
	fingerprint: string;
	createdAt: number;
}

const spares = new Map<string, SpareShell>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

const RC_FILES = [
	".zshenv",
	".zprofile",
	".zshrc",
	".zlogin",
	".bash_profile",
	".bashrc",
	".profile",
	".config/fish/config.fish",
];

function mtimeOf(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

function readGitHead(worktreePath: string): string {
	try {
		const dotGit = join(worktreePath, ".git");
		let gitDir = dotGit;
		const stat = statSync(dotGit);
		if (stat.isFile()) {
			const pointer = readFileSync(dotGit, "utf8").trim();
			const target = pointer.replace(/^gitdir:\s*/, "");
			gitDir = isAbsolute(target) ? target : resolve(worktreePath, target);
		}
		return readFileSync(join(gitDir, "HEAD"), "utf8").trim();
	} catch {
		return "";
	}
}

export function computeSpareFingerprint({
	worktreePath,
	launchEnv,
	home = homedir(),
}: {
	worktreePath: string;
	launchEnv: string;
	home?: string;
}): string {
	const zdotdir = process.env.ZDOTDIR;
	const rcMtimes = RC_FILES.flatMap((file) => [
		mtimeOf(join(home, file)),
		zdotdir ? mtimeOf(join(zdotdir, file)) : 0,
	]);
	return JSON.stringify([rcMtimes, readGitHead(worktreePath), launchEnv]);
}

export function isSpareShell(terminalId: string): boolean {
	return spares.has(terminalId);
}

/** Desktop hosts only: a sandbox pays for every idle shell it keeps. */
export function spareShellsEnabled(): boolean {
	return (
		getHostInstallSource() === "desktop" &&
		process.env.SUPERSET_TERMINAL_SPARE_SHELLS !== "0"
	);
}

const closeDaemonSession = async (terminalId: string): Promise<void> => {
	const daemon = await getDaemonClient();
	await daemon.close(terminalId);
};
let closeSession = closeDaemonSession;

async function closeSpare(terminalId: string): Promise<void> {
	spares.delete(terminalId);
	try {
		await closeSession(terminalId);
	} catch (error) {
		console.warn(`[spare-shells] failed to close spare ${terminalId}`, error);
	}
}

function ensureSweep(): void {
	if (sweepTimer) return;
	sweepTimer = setInterval(() => {
		const now = Date.now();
		for (const [terminalId, spare] of spares) {
			if (now - spare.createdAt > SPARE_TTL_MS) void closeSpare(terminalId);
		}
		if (spares.size === 0 && sweepTimer) {
			clearInterval(sweepTimer);
			sweepTimer = null;
		}
	}, SWEEP_INTERVAL_MS);
	sweepTimer.unref?.();
}

/**
 * Starts a spare for the workspace and returns the id the caller's next new
 * terminal must use. Each id is handed out once; the pool never exceeds
 * {@link MAX_SPARES}, dropping the oldest spare to make room.
 */
export async function prepareSpareShell({
	workspaceId,
	themeType,
	fingerprint,
	spawn,
}: {
	workspaceId: string;
	themeType: string | undefined;
	fingerprint: string;
	spawn: (terminalId: string) => Promise<boolean>;
}): Promise<string | null> {
	if (!spareShellsEnabled()) return null;
	while (spares.size >= MAX_SPARES) {
		const oldest = [...spares.entries()].sort(
			([, a], [, b]) => a.createdAt - b.createdAt,
		)[0];
		if (!oldest) break;
		await closeSpare(oldest[0]);
	}
	const terminalId = crypto.randomUUID();
	spares.set(terminalId, {
		workspaceId,
		themeType,
		fingerprint,
		createdAt: Date.now(),
	});
	let spawned = false;
	try {
		spawned = await spawn(terminalId);
	} catch (error) {
		console.warn("[spare-shells] failed to start a spare", error);
	}
	if (!spawned) {
		spares.delete(terminalId);
		return null;
	}
	ensureSweep();
	return terminalId;
}

/**
 * Hands the spare over to a new terminal when it still matches what a fresh
 * spawn would produce; otherwise closes it so the caller spawns normally.
 */
export async function claimSpareShell({
	terminalId,
	workspaceId,
	themeType,
	fingerprint,
}: {
	terminalId: string;
	workspaceId: string;
	themeType: string | undefined;
	fingerprint: () => string;
}): Promise<boolean> {
	const spare = spares.get(terminalId);
	if (!spare) return false;
	const usable =
		spare.workspaceId === workspaceId &&
		spare.themeType === themeType &&
		Date.now() - spare.createdAt <= SPARE_TTL_MS &&
		spare.fingerprint === fingerprint();
	if (!usable) {
		await closeSpare(terminalId);
		return false;
	}
	spares.delete(terminalId);
	return true;
}

export async function releaseSpareShell(terminalId: string): Promise<void> {
	if (spares.has(terminalId)) await closeSpare(terminalId);
}

export function __resetSpareShellsForTesting(
	close: (terminalId: string) => Promise<void> = closeDaemonSession,
): void {
	closeSession = close;
	spares.clear();
	if (sweepTimer) clearInterval(sweepTimer);
	sweepTimer = null;
}
