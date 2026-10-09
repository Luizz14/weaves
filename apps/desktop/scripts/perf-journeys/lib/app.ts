import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Cdp, type CdpTarget, listTargets } from "./cdp";
import { systemMonotonicNs } from "./clock";
import {
	isAlive,
	mainProcessFor,
	run,
	sleep,
	supersetProcesses,
	waitFor,
} from "./system";

export const REPO_ROOT = join(import.meta.dir, "../../../../..");
export const BENCH_APP = join(
	REPO_ROOT,
	"apps/desktop/release-local-macos/mac-arm64/Superset.app",
);
export const INSTALLED_APP = "/Applications/Superset.app";
export const SUPERSET_HOME = join(homedir(), ".superset");
export const WINDOWS_STATE = join(SUPERSET_HOME, "windows-state.json");

export function benchCli(args: string[]): string {
	return run([
		join(BENCH_APP, "Contents/Resources/resources/bin/superset"),
		...args,
		"--json",
	]);
}

export function readConfirmOnQuit(): { value: boolean; isSet: boolean } {
	const parsed = JSON.parse(benchCli(["settings", "get", "confirmOnQuit"])) as {
		value: boolean;
		isSet: boolean;
	};
	return { value: parsed.value, isSet: parsed.isSet };
}

export function assertNoSupersetRunning(): void {
	const mains = supersetProcesses().filter((p) => p.role === "main");
	if (mains.length > 0) {
		throw new Error(
			`Superset is running (${mains.map((p) => p.bundle).join(", ")}); quit it first`,
		);
	}
}

export interface LaunchResult {
	pid: number;
	spawnNs: bigint;
}

export async function launchApp(
	app: string,
	options: { env?: Record<string, string>; args?: string[] } = {},
): Promise<LaunchResult> {
	assertNoSupersetRunning();
	const envFlags = Object.entries(options.env ?? {}).flatMap(([key, value]) => [
		"--env",
		`${key}=${value}`,
	]);
	const args = options.args?.length ? ["--args", ...options.args] : [];
	const spawnNs = systemMonotonicNs();
	run(["open", "-a", app, ...envFlags, ...args]);
	const main = await waitFor(() => mainProcessFor(app), {
		timeoutMs: 20_000,
		intervalMs: 50,
		label: "main process",
	});
	return { pid: main.pid, spawnNs };
}

export interface QuitResult {
	graceful: boolean;
	windowsStatePersisted: boolean;
	durationMs: number;
}

export async function quitApp(
	app: string,
	pid: number,
	options: {
		allowKill?: boolean;
		method?: "sigterm" | "applescript";
		timeoutMs?: number;
	} = {},
): Promise<QuitResult> {
	const method = options.method ?? "sigterm";
	const started = performance.now();
	const hostPids = supersetProcesses()
		.filter((p) => p.role === "host-service" && p.ppid === pid)
		.map((p) => p.pid);
	const stateBefore = existsSync(WINDOWS_STATE)
		? statSync(WINDOWS_STATE).mtimeMs
		: 0;
	const running = mainProcessFor(app);
	if (!running || running.pid !== pid) {
		throw new Error("refusing to quit: main pid does not match the bench app");
	}
	const exited = () => !isAlive(pid) && hostPids.every((h) => !isAlive(h));
	const waitExit = () =>
		waitFor(exited, {
			timeoutMs: options.timeoutMs ?? 20_000,
			intervalMs: 100,
			label: "app exit",
		})
			.then(() => true)
			.catch(() => false);
	const viaAppleScript = () => {
		if (mainProcessFor(app)?.pid !== pid) return;
		run(["osascript", "-e", `tell application "${app}" to quit`], {
			allowFailure: true,
		});
	};
	if (method === "applescript") viaAppleScript();
	else process.kill(pid, "SIGTERM");
	const graceful = await waitExit();
	if (!graceful && isAlive(pid)) {
		if (!options.allowKill) {
			throw new Error("the app did not quit; refusing to force-kill it");
		}
		process.kill(pid, "SIGKILL");
		await sleep(1000);
	}
	await sleep(2000);
	const relaunched = mainProcessFor(app);
	if (relaunched && relaunched.pid !== pid) {
		throw new Error(
			`the app was relaunched while quitting (new pid ${relaunched.pid})`,
		);
	}
	const stateAfter = existsSync(WINDOWS_STATE)
		? statSync(WINDOWS_STATE).mtimeMs
		: 0;
	const windowsStatePersisted = stateAfter > stateBefore;
	return {
		graceful: graceful && windowsStatePersisted,
		windowsStatePersisted,
		durationMs: performance.now() - started,
	};
}

export async function findPageTarget(
	port: number,
	app: string,
): Promise<CdpTarget> {
	const expected = `${app}/Contents/Resources/app.asar/dist/renderer/index.html`;
	return waitFor(
		async () => {
			let targets: CdpTarget[];
			try {
				targets = await listTargets(port);
			} catch {
				return null;
			}
			const pages = targets.filter(
				(t) =>
					t.type === "page" &&
					t.url.startsWith("file://") &&
					decodeURIComponent(t.url).includes(expected),
			);
			if (pages.length > 1) throw new Error("more than one renderer page");
			return pages[0] ?? null;
		},
		{ timeoutMs: 30_000, intervalMs: 100, label: "renderer page target" },
	);
}

export interface MainOrigin {
	originNs: bigint;
	bracketOk: boolean;
}

export async function readMainOrigin(port: number): Promise<MainOrigin> {
	const target = await waitFor(
		async () => {
			try {
				const response = await fetch(`http://127.0.0.1:${port}/json/list`);
				const list = (await response.json()) as CdpTarget[];
				return list[0]?.webSocketDebuggerUrl ? list[0] : null;
			} catch {
				return null;
			}
		},
		{ timeoutMs: 10_000, label: "main inspector" },
	);
	const cdp = await Cdp.connect(target.webSocketDebuggerUrl as string);
	try {
		const before = systemMonotonicNs();
		const observed = BigInt(
			await cdp.eval<string>("String(process.hrtime.bigint())"),
		);
		const after = systemMonotonicNs();
		const originNs = BigInt(
			await cdp.eval<string>(
				"String(process.hrtime.bigint() - BigInt(Math.round(process.uptime() * 1e9)))",
			),
		);
		return { originNs, bracketOk: before <= observed && observed <= after };
	} finally {
		cdp.close();
	}
}

export interface HostManifest {
	endpoint: string;
	authToken: string;
	organizationId: string;
	pid: number;
}

export function readHostManifestForPort(port: number): HostManifest | null {
	const hostDir = join(SUPERSET_HOME, "host");
	if (!existsSync(hostDir)) return null;
	for (const org of run(["ls", hostDir]).split("\n").filter(Boolean)) {
		const path = join(hostDir, org, "manifest.json");
		if (!existsSync(path)) continue;
		const manifest = JSON.parse(readFileSync(path, "utf8")) as HostManifest;
		if (new URL(manifest.endpoint).port === String(port)) return manifest;
	}
	return null;
}

export async function hostMutation(
	manifest: HostManifest,
	procedure: string,
	input: Record<string, unknown>,
): Promise<{ ok: boolean; status: number }> {
	const response = await fetch(`${manifest.endpoint}/trpc/${procedure}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${manifest.authToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ json: input }),
	});
	await response.arrayBuffer();
	return { ok: response.ok, status: response.status };
}
