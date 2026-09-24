// Singleton DaemonSupervisor for the host-service process. One supervisor
// per host-service instance; it manages exactly one daemon (per the org
// host-service was started with). Lazy bootstrap so tests can construct
// host-service without spawning a real daemon — the bootstrap is kicked
// off explicitly from `serve.ts`.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonSupervisor } from "./DaemonSupervisor.ts";

let supervisor: DaemonSupervisor | null = null;
let bootstrapPromise: Promise<unknown> | null = null;

/**
 * Resolve the daemon entry script path. In production, host-service.cjs and
 * pty-daemon.cjs are emitted into the desktop main root. In dev, fall back to
 * the workspace package's built entry.
 */
export function resolveSupervisorScriptPath(): string {
	const override = process.env.SUPERSET_PTY_DAEMON_SCRIPT_PATH;
	if (override) return override;

	const here = path.dirname(fileURLToPath(import.meta.url));
	// The desktop Vite build can place this module in chunks/, while the
	// pty-daemon entry remains in the main root.
	for (const directory of [here, path.resolve(here, "..")]) {
		for (const fileName of ["pty-daemon.cjs", "pty-daemon.js"]) {
			const candidate = path.resolve(directory, fileName);
			if (existsSync(candidate)) return candidate;
		}
	}

	// Source-running fallback (`bun run` from packages/host-service):
	// `here` is `packages/host-service/src/daemon/`; the daemon's bundled
	// entry sits in `packages/pty-daemon/dist` after its build.
	for (const fileName of ["pty-daemon.cjs", "pty-daemon.js"]) {
		const workspaceDist = path.resolve(
			here,
			"..",
			"..",
			"..",
			"pty-daemon",
			"dist",
			fileName,
		);
		if (existsSync(workspaceDist)) return workspaceDist;
	}
	return path.resolve(
		here,
		"..",
		"..",
		"..",
		"pty-daemon",
		"dist",
		"pty-daemon.cjs",
	);
}

export function getSupervisor(scriptPath?: string): DaemonSupervisor {
	if (!supervisor) {
		supervisor = new DaemonSupervisor({
			scriptPath: scriptPath ?? resolveSupervisorScriptPath(),
		});
	}
	return supervisor;
}

/**
 * Kick off `ensure(orgId)` without awaiting (per the host-service
 * migration plan, decision D3 — fire-and-track). Stash the promise so
 * callers that need the daemon up can await it via `waitForDaemonReady`.
 */
export function startDaemonBootstrap(organizationId: string): void {
	if (bootstrapPromise) return;
	const sup = getSupervisor();
	console.log(`[supervisor] kicking off bootstrap for org=${organizationId}`);
	bootstrapPromise = sup
		.ensure(organizationId)
		.then((inst) => {
			console.log(
				`[supervisor] bootstrap OK for org=${organizationId} pid=${inst.pid} version=${inst.runningVersion}${inst.updatePending ? " (update pending)" : ""}`,
			);
			return inst;
		})
		.catch((err) => {
			console.error(
				`[supervisor] bootstrap failed for org=${organizationId}:`,
				err,
			);
			// Reset so a future request can retry.
			bootstrapPromise = null;
			throw err;
		});
}

/**
 * Awaits the in-flight bootstrap. If bootstrap hasn't started, kicks one
 * off first. Terminal request handlers call this before using the
 * supervisor's socket path.
 */
export async function waitForDaemonReady(
	organizationId: string,
): Promise<void> {
	if (!bootstrapPromise) startDaemonBootstrap(organizationId);
	if (bootstrapPromise) {
		await bootstrapPromise;
	}
	// The bootstrap promise is one-shot: it stays resolved after the daemon
	// it started dies later (adopted-daemon death, crash circuit), leaving
	// getSocketPath() null forever. ensure() is a map lookup while the
	// instance is alive; when it's gone it re-adopts/respawns, or throws
	// the real circuit-open error instead of "no socket path".
	await getSupervisor().ensure(organizationId);
}

/** Test-only — reset the singleton between tests. */
export function __resetSupervisorForTesting(): void {
	supervisor = null;
	bootstrapPromise = null;
}
