import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { StartupMarker } from "../../src/shared/startup-diagnostics";
import { runChangesPanelWarm } from "./journeys/changes-panel";
import { runClaudeSession } from "./journeys/claude-session";
import { runCodexChat } from "./journeys/codex-chat";
import type { BenchContext } from "./journeys/context";
import {
	openNewWorkspaceScreen,
	runCreateWorkspace,
} from "./journeys/create-workspace";
import { runEditorSwitch } from "./journeys/editor-switch";
import { runKeystrokeEcho } from "./journeys/keystroke-echo";
import { runNewTerminal } from "./journeys/new-terminal";
import { runQuickOpen } from "./journeys/quick-open";
import {
	runReloadCycles,
	runSwitchRevisits,
} from "./journeys/switch-workspace";
import {
	assertNoSupersetRunning,
	BENCH_APP,
	benchCli,
	findPageTarget,
	type HostManifest,
	hostMutation,
	INSTALLED_APP,
	launchApp,
	quitApp,
	REPO_ROOT,
	readConfirmOnQuit,
	readHostManifestForPort,
	readMainOrigin,
	SUPERSET_HOME,
} from "./lib/app";
import { Cdp } from "./lib/cdp";
import { CreateInterceptor } from "./lib/create-interceptor";
import { projectRepoPath, projectsOf, workspaceRow } from "./lib/hostdb";
import { loadTranslator } from "./lib/i18n";
import { pressChord } from "./lib/input";
import { Journal } from "./lib/journal";
import { launchSchedule } from "./lib/schedule";
import { SampleSink, Session } from "./lib/session";
import {
	type LaunchRecord,
	P00_MARKERS,
	summarizeJourneys,
	summarizeLaunches,
} from "./lib/summary";
import {
	freePort,
	frontmostBundlePath,
	isOnAcPower,
	isScreenLocked,
	mainProcessFor,
	run,
	sha256File,
	sleep,
	supersetProcesses,
	thermalState,
	waitFor,
} from "./lib/system";
import { renderReport } from "./report/render";

const ALL_JOURNEYS = [
	"new-terminal",
	"keystroke-echo",
	"codex-chat",
	"quick-open",
	"editor-switch",
	"changes-panel",
	"switch-workspace",
	"reload-cycles",
	"codex-cold",
	"claude-session",
	"create-workspace",
] as const;

const { values: args } = parseArgs({
	options: {
		pilot: { type: "boolean", default: false },
		journeys: { type: "string" },
		launches: { type: "string", default: "21" },
		"plain-launches": { type: "string", default: "10" },
		"skip-launch": { type: "boolean", default: false },
		"skip-interaction": { type: "boolean", default: false },
		"perf-bench": { type: "string" },
		"codex-cold": { type: "string", default: "5" },
		restore: { type: "string" },
		report: { type: "string" },
	},
});

const PROBE_SOURCE = readFileSync(
	join(import.meta.dir, "probe/probe.js"),
	"utf8",
);
const OUT_ROOT = join(REPO_ROOT, "apps/desktop/.tmp/perf-journeys");
const BACKUP_ROOT = join(homedir(), ".superset-perf-journeys-backup");

function log(message: string) {
	console.log(`[perf-journeys] ${message}`);
}

function timestampId(): string {
	return new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d+Z$/, "")
		.replace("T", "-");
}

function selectedJourneys(): Set<string> {
	if (!args.journeys) return new Set(ALL_JOURNEYS);
	const wanted = args.journeys.split(",").map((j) => j.trim());
	for (const journey of wanted) {
		if (!(ALL_JOURNEYS as readonly string[]).includes(journey)) {
			throw new Error(`unknown journey ${journey}`);
		}
	}
	return new Set(wanted);
}

function longRunningCodexTurns(): number {
	const hostPids = new Set(
		supersetProcesses()
			.filter((p) => p.role === "host-service")
			.map((p) => p.pid),
	);
	const output = run(["ps", "-axo", "pid=,ppid=,etime=,args="]);
	let count = 0;
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
		if (!match) continue;
		const [, , ppid, etime, command] = match as [
			string,
			string,
			string,
			string,
			string,
		];
		if (!hostPids.has(Number(ppid)) || !/codex\b.*app-server/.test(command))
			continue;
		const parts = etime.replace("-", ":").split(":").map(Number);
		const seconds = parts.reduce((total, part) => total * 60 + part, 0);
		if (seconds > 30) count++;
	}
	return count;
}

interface Bench {
	pid: number;
	port: number;
	cdp: Cdp;
	session: Session;
}

async function reattachBench(bench: Bench): Promise<void> {
	if (!mainProcessFor(BENCH_APP)) throw new Error("the bench app is gone");
	const target = await findPageTarget(bench.port, BENCH_APP);
	const cdp = await Cdp.connect(target.webSocketDebuggerUrl as string);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source: PROBE_SOURCE,
	});
	await reloadRenderer(cdp);
	bench.cdp = cdp;
	bench.session.cdp = cdp;
}

async function runGuarded(
	bench: Bench,
	name: string,
	journey: () => Promise<void>,
): Promise<void> {
	try {
		await journey();
	} catch (error) {
		log(`${name} stopped: ${(error as Error).message.slice(0, 160)}`);
		if (bench.cdp.isClosed) {
			log("renderer connection lost; reattaching");
			await reattachBench(bench);
		} else {
			await bench.session.closeDialogs().catch(() => undefined);
		}
	}
}

async function attachBench(
	launch: { pid: number },
	port: number,
	sink: SampleSink,
): Promise<Bench> {
	const target = await findPageTarget(port, BENCH_APP);
	const cdp = await Cdp.connect(target.webSocketDebuggerUrl as string);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source: PROBE_SOURCE,
	});
	await reloadRenderer(cdp);
	const lang = await cdp.eval<string>("document.documentElement.lang");
	const session = new Session(cdp, loadTranslator(lang), sink, log);
	return { pid: launch.pid, port, cdp, session };
}

async function reloadRenderer(cdp: Cdp): Promise<void> {
	await cdp.send("Page.reload", {});
	await waitFor(
		() =>
			cdp
				.eval<boolean>(
					`!!window.__perfProbe && document.readyState === "complete"`,
				)
				.catch(() => false),
		{ timeoutMs: 30_000, intervalMs: 200, label: "probe after reload" },
	);
	await waitFor(
		() =>
			cdp
				.eval<boolean>(
					`location.hash.startsWith("#/v2-workspace/") ? !!document.querySelector("[data-workspace-id]") : location.hash.length > 2`,
				)
				.catch(() => false),
		{ timeoutMs: 60_000, intervalMs: 200, label: "dashboard after reload" },
	);
}

async function launchBenchForInteraction(sink: SampleSink): Promise<Bench> {
	const port = await freePort();
	const launch = await launchApp(BENCH_APP, {
		env: { DISABLE_UPDATE_CHECK: "1" },
		args: [`--remote-debugging-port=${port}`],
	});
	const bench = await attachBench(launch, port, sink);
	await settleFocus(bench.session);
	return bench;
}

async function settleFocus(session: Session): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await session.ensureFocus();
		await sleep(1500);
		if (await session.eval<boolean>("document.hasFocus()")) return;
	}
	log("warning: the bench window did not keep focus after launch");
}

async function closeBench(bench: Bench | null): Promise<void> {
	if (!bench) return;
	bench.cdp.close();
	const result = await quitApp(BENCH_APP, bench.pid, {
		allowKill: true,
		timeoutMs: 30_000,
	});
	if (!result.graceful) log("warning: bench app did not quit gracefully");
}

function manifestFor(session: Session): Promise<HostManifest> {
	return session
		.eval<string | null>("window.__perfProbe.localHostPort()")
		.then((port) => {
			const manifest = port ? readHostManifestForPort(Number(port)) : null;
			if (!manifest)
				throw new Error("could not resolve the local host-service manifest");
			return manifest;
		});
}

function projectChoice(manifest: HostManifest) {
	const projects = projectsOf(manifest.organizationId);
	const target = projects.find((p) => p.repoPath === REPO_ROOT);
	if (!target) {
		throw new Error(
			"this repository is not a project of the active organization",
		);
	}
	return { name: target.name, knownNames: projects.map((p) => p.name) };
}

function aliasFor(ids: string[], id: string): string {
	const index = ids.indexOf(id);
	return index === -1 ? "ws#?" : `ws#${index + 1}`;
}

async function createPerfBench(
	bench: Bench,
	journal: Journal,
): Promise<{ id: string; worktreePath: string }> {
	const { session } = bench;
	const branch = `perf-bench-${journal.state.runId}`;
	let pendingName = "perf-bench";
	let manifest = await manifestFor(session);
	const interceptor = new CreateInterceptor(
		bench.cdp,
		(input) => {
			const repo = input.projectId
				? projectRepoPath(manifest.organizationId, input.projectId)
				: null;
			if (input.checkout === "local") {
				return {
					allow: false,
					reason: "local checkout",
					name: pendingName,
					branch,
				};
			}
			if (repo !== REPO_ROOT) {
				return {
					allow: false,
					reason: "project is not this repository",
					name: pendingName,
					branch,
				};
			}
			return { allow: true, name: pendingName, branch };
		},
		(input, decision) => {
			if (!decision.allow) {
				log(`perf-bench create refused: ${decision.reason}`);
				return;
			}
			journal.update({
				perfBench: {
					id: input.id ?? "",
					branch,
					projectId: input.projectId ?? "",
				},
			});
		},
	);
	interceptor.onError = (error) =>
		log(`create proxy aborted: ${error.message}`);
	await interceptor.enable();
	try {
		await openNewWorkspaceScreen(
			{ session } as BenchContext,
			projectChoice(manifest),
		);
		pendingName = "perf-bench";
		await pressChord(bench.cdp, "meta+enter", {
			allowEnterIn: "new-workspace",
		});
		const id = await waitFor(() => journal.state.perfBench?.id || null, {
			timeoutMs: 15_000,
			label: "perf-bench create request",
		});
		await session.waitWorkspaceVisible(id, 120_000);
		manifest = await manifestFor(session);
		const row = await waitFor(() => workspaceRow(manifest.organizationId, id), {
			timeoutMs: 30_000,
			label: "perf-bench host row",
		});
		if (!row.branch.includes(branch)) {
			throw new Error(
				"perf-bench was created without the requested branch; stopping",
			);
		}
		return { id, worktreePath: row.worktreePath };
	} finally {
		await interceptor.disable();
	}
}

async function ensurePerfBenchTerminal(bench: Bench, workspaceId: string) {
	const { session } = bench;
	await session.gotoWorkspace(workspaceId);
	const hasTerminal = await session.eval<boolean>(
		`!!document.querySelector('[data-workspace-id="${workspaceId}"] .xterm')`,
	);
	if (hasTerminal) return;
	await pressChord(bench.cdp, "meta+j");
	await waitFor(
		() =>
			session.eval<boolean>(
				`(() => { const el = document.querySelector('[data-workspace-id="${workspaceId}"] .xterm'); return !!el && el.getClientRects().length > 0; })()`,
			),
		{ timeoutMs: 20_000, label: "perf-bench terminal" },
	);
	await sleep(2000);
}

const FIXTURE_LINE = "\n<!-- perf-journeys fixture: safe to delete -->\n";

async function applyFixture(
	journal: Journal,
	worktreePath: string,
	outDir: string,
) {
	const path = join(worktreePath, "README.md");
	if (journal.state.fixture && !journal.state.fixture.reverted) return;
	const backupPath = join(outDir, "fixture-README.md.original");
	const originalSha256 = await sha256File(path);
	writeFileSync(backupPath, readFileSync(path), { mode: 0o600 });
	appendFileSync(path, FIXTURE_LINE);
	journal.update({
		fixture: { path, backupPath, originalSha256, reverted: false },
	});
}

async function revertFixture(journal: Journal) {
	const fixture = journal.state.fixture;
	if (!fixture || fixture.reverted) return;
	if (existsSync(fixture.backupPath)) {
		writeFileSync(fixture.path, readFileSync(fixture.backupPath));
		if ((await sha256File(fixture.path)) === fixture.originalSha256) {
			journal.update({ fixture: { ...fixture, reverted: true } });
			return;
		}
	}
	log("warning: fixture could not be reverted automatically");
}

interface ScanResult {
	switchTargets: string[];
	chatWorkspace: string | null;
}

async function scanWorkspaces(
	bench: Bench,
	perfBenchId: string,
): Promise<ScanResult> {
	const { session } = bench;
	const candidates = await session.paletteWorkspaceIds();
	log(`scan: ${candidates.length} workspaces listed in the palette`);
	const switchTargets: string[] = [];
	let chatWorkspace: string | null = null;
	for (const id of candidates.filter((c) => c !== perfBenchId).slice(0, 10)) {
		if (switchTargets.length >= 3 && chatWorkspace) break;
		try {
			await session.gotoWorkspace(id);
		} catch {
			continue;
		}
		await sleep(3000);
		const shape = await session.eval<{
			terminal: boolean;
			chat: boolean;
			webview: boolean;
		}>(`(() => {
			const root = document.querySelector('[data-workspace-id="${id}"]');
			const visible = (el) => !!el && el.getClientRects().length > 0 && !el.closest("#terminal-parking");
			return {
				terminal: !!root && [...root.querySelectorAll(".xterm")].some(visible),
				chat: !!root && [...root.querySelectorAll('[role="log"] article[data-slot="message"]')].some(visible),
				webview: !!root && !!root.querySelector("webview"),
			};
		})()`);
		const sockets = await session.eval<{ terminals: number; local: boolean }>(
			`window.__perfProbe.workspaceSocketInfo("${id}")`,
		);
		if (shape.webview) continue;
		if (shape.terminal && sockets.local && switchTargets.length < 3) {
			switchTargets.push(id);
		} else if (shape.chat && !shape.terminal && !chatWorkspace) {
			chatWorkspace = id;
		}
	}
	await session.gotoWorkspace(perfBenchId);
	return { switchTargets, chatWorkspace };
}

async function waitForMarker(path: string, marker: string, timeoutMs: number) {
	await waitFor(
		() =>
			existsSync(path) && readFileSync(path, "utf8").includes(`"${marker}"`),
		{ timeoutMs, intervalMs: 100, label: marker },
	).catch(() => undefined);
}

function readP00(path: string): LaunchRecord["markersMs"] {
	if (!existsSync(path)) return {};
	const markers: LaunchRecord["markersMs"] = {};
	for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
		const record = JSON.parse(line) as { marker: string; durationMs: number };
		if ((P00_MARKERS as readonly string[]).includes(record.marker)) {
			markers[record.marker as StartupMarker] = record.durationMs;
		}
	}
	return markers;
}

async function runLaunchLoop(outDir: string, total: number, plain: number) {
	const launchDir = join(outDir, "launch");
	mkdirSync(launchDir, { recursive: true });
	const records: LaunchRecord[] = [];
	const schedule = launchSchedule(total, plain);
	for (let index = 0; index < schedule.length; index++) {
		const inspect = schedule[index] as boolean;
		const jsonl = join(
			launchDir,
			`p00-${String(index + 1).padStart(2, "0")}.jsonl`,
		);
		const inspectPort = inspect ? await freePort() : null;
		const screenLockedBefore = isScreenLocked();
		const launch = await launchApp(BENCH_APP, {
			env: { SUPERSET_STARTUP_DIAGNOSTICS: jsonl, DISABLE_UPDATE_CHECK: "1" },
			args: inspectPort ? [`--inspect=127.0.0.1:${inspectPort}`] : [],
		});
		await waitForMarker(jsonl, "terminal-usable", 60_000);
		let preNodeMs: number | null = null;
		let bracketOk: boolean | null = null;
		if (inspectPort) {
			try {
				const origin = await readMainOrigin(inspectPort);
				bracketOk = origin.bracketOk;
				preNodeMs = Number(origin.originNs - launch.spawnNs) / 1e6;
			} catch (error) {
				log(
					`launch ${index + 1}: inspector unavailable (${(error as Error).message})`,
				);
			}
		}
		const frontmost = frontmostBundlePath() === BENCH_APP;
		const screenLocked = screenLockedBefore || isScreenLocked();
		await sleep(2000);
		const quit = await quitApp(BENCH_APP, launch.pid, {
			allowKill: true,
			timeoutMs: 30_000,
		});
		const record: LaunchRecord = {
			index: index + 1,
			phase: index === 0 ? "warmup" : "measured",
			inspect,
			markersMs: readP00(jsonl),
			preNodeMs,
			bracketOk,
			frontmost,
			screenLocked,
			gracefulQuit: quit.graceful,
			windowsStatePersisted: quit.windowsStatePersisted,
		};
		records.push(record);
		appendFileSync(
			join(outDir, "launches.jsonl"),
			`${JSON.stringify(record)}\n`,
		);
		const usable = record.markersMs["terminal-usable"];
		log(
			`launch ${index + 1} (${inspect ? "inspect" : "plain"}): shell ${record.markersMs["shell-interactive"]?.toFixed(0) ?? "-"} ms, terminal ${usable?.toFixed(0) ?? "-"} ms, preNode ${preNodeMs?.toFixed(0) ?? "-"} ms, quit ${quit.graceful ? "ok" : "forced"}`,
		);
		await sleep(1500);
	}
	return records;
}

async function destroyCreated(
	journal: Journal,
	manifest: HostManifest,
	keepPerfBench: boolean,
): Promise<void> {
	for (const created of journal.state.createdWorkspaces) {
		if (created.destroyed) continue;
		if (!created.branch.includes(`perf-bench-${journal.state.runId}-`))
			continue;
		const result = await hostMutation(manifest, "workspaceCleanup.destroy", {
			workspaceId: created.id,
			deleteBranch: true,
			force: true,
			skipTeardown: true,
		});
		if (result.ok) created.destroyed = true;
		else
			log(`warning: destroy of a created workspace returned ${result.status}`);
		journal.save();
	}
	if (!keepPerfBench)
		log("perf-bench is kept until the user confirms its removal");
}

async function restore(journal: Journal, bench: Bench | null): Promise<void> {
	log("restoring");
	if (bench) {
		try {
			const manifest = await manifestFor(bench.session);
			await destroyCreated(journal, manifest, true);
			const hash = await bench.session.eval<string>("location.hash");
			if (hash.startsWith("#/new-workspace")) {
				await pressChord(bench.cdp, "escape").catch(() => undefined);
				await sleep(500);
			}
			const original = journal.state.originalWorkspaceId;
			if (original)
				await bench.session.gotoWorkspace(original).catch(() => undefined);
			await sleep(2000);
		} catch (error) {
			log(
				`warning: restore inside the bench app failed: ${(error as Error).message}`,
			);
		}
		await closeBench(bench).catch((error) =>
			log(`warning: bench quit failed: ${(error as Error).message}`),
		);
	}
	await revertFixture(journal);
	if (journal.state.confirmOnQuitChanged) {
		benchCli(["settings", "reset", "confirmOnQuit"]);
		const after = readConfirmOnQuit();
		if (!after.isSet) journal.update({ confirmOnQuitChanged: false });
		else log("warning: confirmOnQuit could not be reset");
	}
	const strayBench = mainProcessFor(BENCH_APP);
	if (strayBench) {
		await quitApp(BENCH_APP, strayBench.pid, {
			allowKill: true,
			timeoutMs: 30_000,
		}).catch((error) => log(`warning: ${(error as Error).message}`));
	}
	if (!mainProcessFor(INSTALLED_APP)) {
		assertNoSupersetRunning();
		run(["open", "-a", INSTALLED_APP]);
	}
	const pending = journal.state.createdWorkspaces.filter((w) => !w.destroyed);
	if (pending.length > 0) {
		log(
			`${pending.length} created workspace(s) still pending; retrying through the installed app`,
		);
		try {
			const manifest = await waitFor(
				() => {
					const hostDir = join(SUPERSET_HOME, "host");
					for (const org of run(["ls", hostDir]).split("\n").filter(Boolean)) {
						const path = join(hostDir, org, "manifest.json");
						if (!existsSync(path)) continue;
						const parsed = JSON.parse(
							readFileSync(path, "utf8"),
						) as HostManifest;
						if (
							journal.state.perfBench &&
							workspaceRow(parsed.organizationId, journal.state.perfBench.id)
						) {
							return parsed;
						}
					}
					return null;
				},
				{
					timeoutMs: 60_000,
					intervalMs: 1000,
					label: "installed host-service",
				},
			);
			await sleep(3000);
			await destroyCreated(journal, manifest, true);
		} catch (error) {
			log(`warning: ${(error as Error).message}`);
		}
	}
	journal.update({ restored: true });
}

async function verifyAfterRestore(
	journal: Journal,
): Promise<Record<string, unknown>> {
	await sleep(5000);
	const processes = supersetProcesses();
	const installedMain = processes.some(
		(p) => p.role === "main" && p.bundle === INSTALLED_APP,
	);
	const ptyNow = processes
		.filter((p) => p.role === "pty-daemon")
		.map((p) => p.pid);
	const branches = run(
		[
			"git",
			"-C",
			REPO_ROOT,
			"branch",
			"--list",
			`*perf-bench-${journal.state.runId}-*`,
		],
		{ allowFailure: true },
	).trim();
	const worktrees = run(["git", "-C", REPO_ROOT, "worktree", "list"], {
		allowFailure: true,
	})
		.split("\n")
		.filter((line) =>
			line.includes(`perf-bench-${journal.state.runId}-`),
		).length;
	const installedAsar = await sha256File(
		join(INSTALLED_APP, "Contents/Resources/app.asar"),
	);
	return {
		installedAppRunning: installedMain,
		ptyDaemonsUnchanged: journal.state.ptyDaemonPids.every((pid) =>
			ptyNow.includes(pid),
		),
		leftoverBranches: branches ? branches.split("\n").length : 0,
		leftoverWorktrees: worktrees,
		installedAsarUnchanged: installedAsar === journal.state.installedAsarSha256,
		fixtureReverted: journal.state.fixture?.reverted ?? true,
		confirmOnQuitDefault: !readConfirmOnQuit().isSet,
	};
}

function writeSummary(outDir: string, runMeta: Record<string, unknown>) {
	const samples = existsSync(join(outDir, "samples.jsonl"))
		? readFileSync(join(outDir, "samples.jsonl"), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
		: [];
	const launches = existsSync(join(outDir, "launches.jsonl"))
		? readFileSync(join(outDir, "launches.jsonl"), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as LaunchRecord)
		: [];
	const summary = {
		journeys: summarizeJourneys(samples),
		launch: summarizeLaunches(launches),
	};
	writeFileSync(
		join(outDir, "summary.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
	writeFileSync(
		join(outDir, "report.html"),
		renderReport({ run: runMeta, summary }),
	);
	writeFileSync(
		join(outDir, "evidence.json"),
		`${JSON.stringify({ schemaVersion: 1, run: sanitizeRunMeta(runMeta), summary }, null, 2)}\n`,
	);
	return summary;
}

const EVIDENCE_RUN_FIELDS = [
	"runId",
	"pilot",
	"gitHead",
	"gitDirty",
	"appVersion",
	"benchAsarSha256",
	"hardware",
	"cpuBrand",
	"memoryGiB",
	"macos",
	"locale",
	"frameIntervalMs",
	"acPowerAtStart",
	"acPowerAtEnd",
	"thermalAtStart",
	"thermalAtEnd",
	"switchTargets",
	"chatWorkspace",
	"acceptedRun",
	"error",
	"verification",
];

function sanitizeRunMeta(runMeta: Record<string, unknown>) {
	return Object.fromEntries(
		EVIDENCE_RUN_FIELDS.filter((key) => key in runMeta).map((key) => [
			key,
			runMeta[key],
		]),
	);
}

async function backupProfile(runId: string): Promise<string> {
	const dir = join(BACKUP_ROOT, runId);
	mkdirSync(dir, { recursive: true });
	chmodSync(BACKUP_ROOT, 0o700);
	chmodSync(dir, 0o700);
	const partition = join(
		homedir(),
		"Library/Application Support/Superset/Partitions/superset",
	);
	for (const name of ["Local Storage", "IndexedDB"]) {
		const source = join(partition, name);
		if (existsSync(source)) run(["ditto", source, join(dir, name)]);
	}
	for (const name of [
		"app-state.json",
		"window-state.json",
		"windows-state.json",
	]) {
		const source = join(SUPERSET_HOME, name);
		if (existsSync(source)) run(["ditto", source, join(dir, name)]);
	}
	return dir;
}

async function main(): Promise<number> {
	if (args.report) {
		const outDir = args.report;
		const runMeta = JSON.parse(readFileSync(join(outDir, "run.json"), "utf8"));
		writeSummary(outDir, runMeta);
		log(`report written to ${join(outDir, "report.html")}`);
		return 0;
	}
	if (args.restore) {
		const journal = Journal.load(args.restore);
		const running = mainProcessFor(BENCH_APP);
		if (running) {
			const result = await quitApp(BENCH_APP, running.pid, {
				allowKill: true,
				timeoutMs: 30_000,
			});
			log(`bench app quit (${result.graceful ? "graceful" : "forced"})`);
		}
		await restore(journal, null);
		log(JSON.stringify(await verifyAfterRestore(journal)));
		return 0;
	}

	const journeys = selectedJourneys();
	const pilot = args.pilot;
	const runId = timestampId();
	const outDir = join(OUT_ROOT, runId);
	mkdirSync(outDir, { recursive: true });
	const journal = Journal.create(join(outDir, "journal.json"), runId);
	const sink = new SampleSink(join(outDir, "samples.jsonl"));
	log(`run ${runId}${pilot ? " (pilot)" : ""}, output in ${outDir}`);

	if (!existsSync(BENCH_APP)) throw new Error("bench app not built");
	if (isScreenLocked()) throw new Error("screen is locked");
	const runMeta: Record<string, unknown> = {
		runId,
		pilot,
		gitHead: run(["git", "-C", REPO_ROOT, "rev-parse", "HEAD"]).trim(),
		gitDirty:
			run(["git", "-C", REPO_ROOT, "status", "--porcelain"]).trim().length > 0,
		benchAsarSha256: await sha256File(
			join(BENCH_APP, "Contents/Resources/app.asar"),
		),
		appVersion: run([
			"/usr/libexec/PlistBuddy",
			"-c",
			"Print CFBundleShortVersionString",
			join(BENCH_APP, "Contents/Info.plist"),
		]).trim(),
		hardware: run(["sysctl", "-n", "hw.model"]).trim(),
		cpuBrand: run(["sysctl", "-n", "machdep.cpu.brand_string"]).trim(),
		memoryGiB: Math.round(
			Number(run(["sysctl", "-n", "hw.memsize"]).trim()) / 2 ** 30,
		),
		macos: run(["sw_vers", "-productVersion"]).trim(),
		acPowerAtStart: isOnAcPower(),
		thermalAtStart: thermalState(),
	};
	journal.update({
		installedAsarSha256: await sha256File(
			join(INSTALLED_APP, "Contents/Resources/app.asar"),
		),
		ptyDaemonPids: supersetProcesses()
			.filter((p) => p.role === "pty-daemon")
			.map((p) => p.pid),
	});

	if (longRunningCodexTurns() > 0) {
		throw new Error(
			"a Codex Chat turn seems to be running; not quitting the app",
		);
	}

	const confirm = readConfirmOnQuit();
	journal.update({ confirmOnQuitOriginallySet: confirm.isSet });
	if (confirm.value) {
		benchCli(["settings", "set", "confirmOnQuit", "false"]);
		journal.update({ confirmOnQuitChanged: true });
	}

	const caffeinate = Bun.spawn([
		"caffeinate",
		"-dims",
		"-w",
		String(process.pid),
	]);
	let bench: Bench | null = null;
	let interrupted = false;
	const onSignal = () => {
		interrupted = true;
		log("interrupted; restoring before exit");
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	process.on("SIGHUP", onSignal);

	try {
		const installed = mainProcessFor(INSTALLED_APP);
		if (installed) {
			log("quitting the installed app");
			const result = await quitApp(INSTALLED_APP, installed.pid, {
				method: "applescript",
				timeoutMs: 90_000,
			});
			journal.update({ installedQuitByHarness: true });
			log(
				`installed app quit (${result.graceful ? "graceful" : "forced"}, windows state persisted: ${result.windowsStatePersisted})`,
			);
		}
		assertNoSupersetRunning();
		journal.update({ backupDir: await backupProfile(runId) });

		log("setup session");
		bench = await launchBenchForInteraction(sink);
		journal.update({ benchPid: bench.pid });
		const hash = await bench.session.eval<string>("location.hash");
		if (
			!hash.startsWith("#/v2-workspace/") &&
			!hash.startsWith("#/new-workspace")
		) {
			throw new Error("the app did not open the v2 UI");
		}
		journal.update({
			originalWorkspaceId: await bench.session.currentWorkspaceId(),
		});
		const overridden = await bench.session.eval<string[]>(`(() => {
			try {
				const raw = JSON.parse(localStorage.getItem("hotkey-overrides") ?? "{}");
				const state = raw.state ?? raw;
				const map = state.overrides ?? state;
				return Object.keys(map ?? {});
			} catch { return []; }
		})()`);
		const used = [
			"QUICK_OPEN",
			"NEW_GROUP",
			"NEW_CODEX_CHAT",
			"OPEN_DIFF_VIEWER",
			"CLOSE_PANE",
			"NEW_WORKSPACE",
		];
		const conflicts = used.filter((id) => overridden.includes(id));
		if (conflicts.length)
			throw new Error(`hotkeys overridden: ${conflicts.join(", ")}`);
		runMeta.locale = bench.session.tr.locale;
		runMeta.frameIntervalMs = await bench.session.eval<number>(
			"window.__perfProbe.frameIntervalMs()",
		);

		let perfBench: { id: string; worktreePath: string };
		if (args["perf-bench"]) {
			const manifest = await manifestFor(bench.session);
			const row = workspaceRow(manifest.organizationId, args["perf-bench"]);
			if (!row || !row.branch.includes("perf-bench")) {
				throw new Error(
					"--perf-bench does not point at a perf-bench workspace",
				);
			}
			perfBench = { id: args["perf-bench"], worktreePath: row.worktreePath };
			journal.update({
				perfBench: {
					id: perfBench.id,
					branch: row.branch,
					projectId: row.projectId ?? "",
				},
			});
		} else {
			perfBench = await createPerfBench(bench, journal);
			log(`perf-bench created (pass --perf-bench ${perfBench.id} to reuse it)`);
		}
		await ensurePerfBenchTerminal(bench, perfBench.id);
		await applyFixture(journal, perfBench.worktreePath, outDir);
		const scan = await scanWorkspaces(bench, perfBench.id);
		const aliases = [
			...scan.switchTargets,
			...(scan.chatWorkspace ? [scan.chatWorkspace] : []),
		];
		runMeta.switchTargets = scan.switchTargets.map((id) =>
			aliasFor(aliases, id),
		);
		runMeta.chatWorkspace = scan.chatWorkspace
			? aliasFor(aliases, scan.chatWorkspace)
			: null;
		log(
			`switch targets: ${scan.switchTargets.length}, conversation workspace: ${scan.chatWorkspace ? "yes" : "no"}`,
		);
		await ensurePerfBenchTerminal(bench, perfBench.id);
		await sleep(2000);
		await closeBench(bench);
		bench = null;
		if (interrupted) throw new Error("interrupted");

		if (!args["skip-launch"]) {
			log("launch loop");
			const launches = pilot ? 3 : Number(args.launches);
			const plain = pilot ? 3 : Number(args["plain-launches"]);
			await runLaunchLoop(outDir, launches, plain);
		}
		if (interrupted) throw new Error("interrupted");

		if (!args["skip-interaction"]) {
			log("interaction session");
			bench = await launchBenchForInteraction(sink);
			journal.update({ benchPid: bench.pid });
			await bench.session.gotoWorkspace(perfBench.id);
			const activeBench = bench;
			const base: BenchContext = {
				session: activeBench.session,
				runId,
				perfBench,
				switchTargets: scan.switchTargets,
				chatWorkspace: scan.chatWorkspace,
				count: (n) => (pilot ? Math.min(n, 3) : n),
				warmups: (n) => (pilot ? Math.min(n, 1) : n),
				reload: async () => {
					await reloadRenderer(activeBench.cdp);
					await activeBench.session.waitWorkspaceVisible(perfBench.id, 60_000);
				},
				log,
			};
			const passes = pilot ? 1 : 3;
			const roundRobin: Array<[string, (ctx: BenchContext) => Promise<void>]> =
				[
					["new-terminal", runNewTerminal],
					["keystroke-echo", runKeystrokeEcho],
					["codex-chat", (ctx) => runCodexChat(ctx, { coldSamples: 0 })],
					["quick-open", runQuickOpen],
					["editor-switch", runEditorSwitch],
					["changes-panel", runChangesPanelWarm],
					["switch-workspace", runSwitchRevisits],
				];
			for (let pass = 0; pass < passes; pass++) {
				const ctx: BenchContext = {
					...base,
					count: (n) => (pilot ? Math.min(n, 3) : Math.ceil(n / passes)),
					warmups: (n) => (pass === 0 ? base.warmups(n) : 0),
				};
				for (const [name, journey] of roundRobin) {
					if (!journeys.has(name) || interrupted) continue;
					log(`${name} (pass ${pass + 1}/${passes})`);
					await runGuarded(activeBench, name, () => journey(ctx));
				}
			}
			if (journeys.has("reload-cycles") && !interrupted) {
				log("reload cycles (first visits, cold diff, conversation)");
				await runGuarded(activeBench, "reload-cycles", () =>
					runReloadCycles(base),
				);
			}
			if (journeys.has("codex-cold") && !interrupted) {
				const cold = pilot ? 1 : Number(args["codex-cold"]);
				log(`codex cold catalog (${cold})`);
				await runGuarded(activeBench, "codex-cold", () =>
					runCodexChat(
						{ ...base, count: () => 0, warmups: () => 0 },
						{ coldSamples: cold },
					),
				);
			}
			if (journeys.has("claude-session") && !interrupted) {
				log("claude session");
				await runGuarded(activeBench, "claude-session", () =>
					runClaudeSession(base),
				);
			}
			if (journeys.has("create-workspace") && !interrupted) {
				log("create workspace");
				let pendingName = "";
				const manifest = await manifestFor(activeBench.session);
				const interceptor = new CreateInterceptor(
					activeBench.cdp,
					(input) => {
						const repo = input.projectId
							? projectRepoPath(manifest.organizationId, input.projectId)
							: null;
						const allow =
							input.checkout !== "local" &&
							repo === REPO_ROOT &&
							!!pendingName &&
							!!input.id &&
							(!input.agents || input.agents.length === 0);
						return {
							allow,
							reason: allow ? undefined : "guard failed",
							name: pendingName,
							branch: pendingName,
						};
					},
					(input, decision) => {
						if (!decision.allow || !input.id) return;
						journal.state.createdWorkspaces.push({
							id: input.id,
							branch: decision.branch,
							destroyed: false,
						});
						journal.save();
					},
				);
				interceptor.onError = (error) =>
					log(`create proxy aborted: ${error.message}`);
				await interceptor.enable();
				try {
					await runCreateWorkspace(base, {
						project: projectChoice(manifest),
						beforeSubmit: (name) => {
							pendingName = name;
						},
						knownWorkspaceIds: async () => [
							perfBench.id,
							...scan.switchTargets,
							...(scan.chatWorkspace ? [scan.chatWorkspace] : []),
						],
						verify: (workspaceId) => {
							const row = workspaceRow(manifest.organizationId, workspaceId);
							return !!row && row.branch.includes(`perf-bench-${runId}-`);
						},
						destroy: async (workspaceId) => {
							if (
								!journal.state.createdWorkspaces.some(
									(w) => w.id === workspaceId,
								)
							) {
								throw new Error(
									"refusing to destroy a workspace this run did not create",
								);
							}
							await destroyCreated(
								journal,
								await manifestFor(activeBench.session),
								true,
							);
						},
					});
				} finally {
					await interceptor.disable();
				}
			}
		}
	} catch (error) {
		log(`error: ${(error as Error).message}`);
		runMeta.error = (error as Error).message;
		if (bench) {
			log(
				`diagnostics: ${await bench.session.diagnose(journal.state.perfBench?.id ?? null)}`,
			);
		}
	} finally {
		await restore(journal, bench);
		caffeinate.kill();
		runMeta.acPowerAtEnd = isOnAcPower();
		runMeta.thermalAtEnd = thermalState();
		runMeta.verification = await verifyAfterRestore(journal);
		runMeta.acceptedRun =
			!runMeta.error &&
			runMeta.acPowerAtStart === true &&
			runMeta.acPowerAtEnd === true;
		writeFileSync(
			join(outDir, "run.json"),
			`${JSON.stringify(runMeta, null, 2)}\n`,
		);
		writeSummary(outDir, runMeta);
		log(`verification: ${JSON.stringify(runMeta.verification)}`);
		log(`report: ${join(outDir, "report.html")}`);
	}
	return runMeta.error ? 1 : 0;
}

process.exit(await main());
