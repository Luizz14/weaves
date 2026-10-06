import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
	FlutterAction,
	FlutterDevice,
	FlutterSessionSnapshot,
} from "@superset/shared/flutter";
import type { HostDb } from "../db";
import { readLspSettings } from "../lsp/settings";
import { treeKillWithEscalation } from "../ports/tree-kill";
import type { WorkspaceFilesystemManager } from "../runtime/filesystem";
import { getTerminalBaseEnv, waitForTerminalBaseEnv } from "../terminal/env";
import { FlutterDap } from "./dap";
import {
	type ResolvedFlutterProfile,
	readFlutterProfiles,
	within,
} from "./launch";
import { resolveFlutterSdk } from "./sdk";
import { DtdConnection, ToolService } from "./services";

type Session = {
	snapshot: FlutterSessionSnapshot;
	root: string;
	resolved: ResolvedFlutterProfile;
	sdk: { flutter: string; dart: string };
	dap: FlutterDap;
	vmUri?: string;
	vm?: DtdConnection;
	dtd?: ToolService;
	dtdConnection?: DtdConnection;
	devtools?: ToolService;
	inspectorUrl?: string;
	inspectorTask?: Promise<string>;
	stopping?: Promise<void>;
	startup: ReturnType<typeof setTimeout>;
	initialized: boolean;
	inspectorIsolate?: string;
	generation: number;
};
export class FlutterSessions {
	private sessions = new Map<string, Session>();
	private starting = new Set<string>();
	private disposed = false;
	private cancelledStarts = new Set<string>();
	private discovery = new Set<ReturnType<typeof spawn>>();
	constructor(
		private options: { db: HostDb; filesystem: WorkspaceFilesystemManager },
	) {}
	private async context(workspaceId: string, activeFile?: string) {
		const root = this.options.filesystem.resolveWorkspaceRoot(workspaceId);
		await waitForTerminalBaseEnv();
		const env = getTerminalBaseEnv();
		const profiles = await readFlutterProfiles(root, activeFile, env);
		return { root, env, profiles };
	}
	async profiles(workspaceId: string, activeFile?: string) {
		return (await this.context(workspaceId, activeFile)).profiles.map(
			(value) => value.profile,
		);
	}
	snapshot(workspaceId: string) {
		return this.sessions.get(workspaceId)?.snapshot ?? null;
	}
	private async sdk(
		root: string,
		profile: ResolvedFlutterProfile,
		env: Record<string, string>,
	) {
		return resolveFlutterSdk(
			root,
			profile.program,
			env,
			readLspSettings(this.options.db).servers.dart.command,
		);
	}
	async devices(
		workspaceId: string,
		profileId?: string,
		activeFile?: string,
	): Promise<FlutterDevice[]> {
		const { root, env, profiles } = await this.context(workspaceId, activeFile);
		const profile =
			profiles.find((value) => value.profile.id === profileId) ??
			profiles.find((value) => !value.profile.diagnostics.length);
		if (!profile) return [];
		const sdk = await this.sdk(root, profile, env);
		if (this.disposed) throw new Error("Flutter host is shutting down");
		const output = await new Promise<string>((resolve, reject) => {
			const child = spawn(sdk.flutter, ["devices", "--machine"], {
				cwd: profile.cwd,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				shell: process.platform === "win32",
			});
			this.discovery.add(child);
			let text = "";
			const timer = setTimeout(() => {
				if (child.pid)
					void treeKillWithEscalation({
						pid: child.pid,
						escalationTimeoutMs: 500,
					});
				reject(new Error("Device discovery timed out"));
			}, 30_000);
			child.stdout.on("data", (chunk) => {
				text += String(chunk);
				if (text.length > 1024 * 1024) {
					if (child.pid)
						void treeKillWithEscalation({
							pid: child.pid,
							escalationTimeoutMs: 500,
						});
					clearTimeout(timer);
					reject(new Error("Device output too large"));
				}
			});
			child.on("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.on("close", (code) => {
				this.discovery.delete(child);
				clearTimeout(timer);
				if (code === 0) resolve(text);
				else reject(new Error("Flutter device discovery failed"));
			});
		});
		const start = output.indexOf("[");
		const end = output.lastIndexOf("]");
		const values = JSON.parse(output.slice(start, end + 1)) as Array<
			Record<string, unknown>
		>;
		return values.flatMap((device) =>
			typeof device.id === "string" && typeof device.name === "string"
				? [
						{
							id: device.id,
							name: device.name,
							platform: String(device.targetPlatform ?? "unknown"),
						},
					]
				: [],
		);
	}
	async start(input: {
		workspaceId: string;
		profileId: string;
		hash: string;
		deviceId?: string;
		activeFile?: string;
	}) {
		if (this.disposed) throw new Error("Flutter host is shutting down");
		const previous = this.sessions.get(input.workspaceId);
		if (previous && !["exited", "error"].includes(previous.snapshot.phase))
			throw new Error(
				"Stop the current Flutter session before starting another",
			);
		if (this.starting.has(input.workspaceId))
			throw new Error("Flutter session is already starting");
		this.starting.add(input.workspaceId);
		this.cancelledStarts.delete(input.workspaceId);
		try {
			if (previous)
				await this.stop(input.workspaceId, previous.snapshot.id, false);
			const { root, env, profiles } = await this.context(
				input.workspaceId,
				input.activeFile,
			);
			const resolved = profiles.find(
				(value) => value.profile.id === input.profileId,
			);
			if (!resolved) throw new Error("Launch profile no longer exists");
			if (resolved.profile.hash !== input.hash)
				throw new Error("Launch configuration changed; refresh profiles");
			if (resolved.profile.diagnostics.length)
				throw new Error(resolved.profile.diagnostics.join("; "));
			const deviceId = resolved.profile.deviceId ?? input.deviceId;
			if (!deviceId) throw new Error("Select a Flutter device");
			const devices = await this.devices(
				input.workspaceId,
				input.profileId,
				input.activeFile,
			);
			if (!devices.some((device) => device.id === deviceId))
				throw new Error("Configured Flutter device is unavailable");
			const sdk = await this.sdk(root, resolved, env);
			if (this.disposed || this.cancelledStarts.has(input.workspaceId))
				throw new Error("Flutter start cancelled");
			const dap = new FlutterDap(sdk.flutter, resolved.cwd, resolved.env);
			const snapshot: FlutterSessionSnapshot = {
				id: crypto.randomUUID(),
				workspaceId: input.workspaceId,
				profileName: resolved.profile.name,
				deviceId,
				phase: "starting",
				mode: resolved.profile.mode,
				canReload: false,
				canInspect: false,
				selectingWidget: false,
				output: "",
			};
			const session: Session = {
				snapshot,
				root,
				resolved,
				sdk,
				dap,
				initialized: false,
				generation: 0,
				startup: setTimeout(() => {
					if (snapshot.phase === "starting")
						this.fail(session, new Error("Flutter launch timed out"));
				}, 120_000),
			};
			this.sessions.set(input.workspaceId, session);
			dap.on("output", (value) => this.output(session, String(value)));
			dap.on("failure", (error) => this.fail(session, error));
			dap.on("exit", () => {
				clearTimeout(session.startup);
				snapshot.canInspect = false;
				snapshot.canReload = false;
				if (snapshot.phase !== "error") snapshot.phase = "exited";
				void this.servicesStop(session);
			});
			dap.on("event", (event: string, body: Record<string, unknown>) =>
				this.event(session, event, body),
			);
			await dap.request("initialize", {
				adapterID: "flutter",
				clientID: "superset",
				clientName: "Superset",
				pathFormat: "path",
				linesStartAt1: true,
				columnsStartAt1: true,
				supportsProgressReporting: true,
				supportsRunInTerminalRequest: false,
			});
			const toolArgs = [...resolved.toolArgs];
			if (
				!toolArgs.some(
					(arg) =>
						arg === "-d" ||
						arg === "--device-id" ||
						arg.startsWith("--device-id="),
				)
			)
				toolArgs.push("-d", deviceId);
			if (
				resolved.profile.mode !== "debug" &&
				!toolArgs.includes(`--${resolved.profile.mode}`)
			)
				toolArgs.push(`--${resolved.profile.mode}`);
			void dap
				.request(
					"launch",
					{
						program: resolved.program,
						cwd: resolved.cwd,
						args: resolved.args,
						toolArgs,
						env: resolved.env,
						noDebug: resolved.noDebug,
					},
					120_000,
				)
				.catch((error) => this.fail(session, error));
			return snapshot;
		} catch (error) {
			const failed = this.sessions.get(input.workspaceId);
			if (failed && failed !== previous) this.fail(failed, error);
			throw error;
		} finally {
			this.starting.delete(input.workspaceId);
			this.cancelledStarts.delete(input.workspaceId);
		}
	}
	private output(session: Session, value: string) {
		let safe = value.replace(
			/(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/[^\s]+/g,
			"[local service URL]",
		);
		for (const secret of [session.vmUri, session.inspectorUrl])
			if (secret) safe = safe.replaceAll(secret, "[service URL]");
		session.snapshot.output = (session.snapshot.output + safe).slice(
			-1024 * 1024,
		);
	}
	private fail(session: Session, error: unknown) {
		if (
			session.snapshot.phase === "stopping" ||
			session.snapshot.phase === "exited"
		)
			return;
		session.snapshot.error =
			error instanceof Error ? error.message : "Flutter session failed";
		session.snapshot.phase = "error";
		session.snapshot.canReload = false;
		session.snapshot.canInspect = false;
		clearTimeout(session.startup);
		void session.dap.stop().catch(() => {});
		void this.servicesStop(session);
	}
	private event(
		session: Session,
		event: string,
		body: Record<string, unknown>,
	) {
		if (
			this.sessions.get(session.snapshot.workspaceId) !== session ||
			["stopping", "exited", "error"].includes(session.snapshot.phase)
		)
			return;
		if (event === "initialized" && !session.initialized) {
			session.initialized = true;
			void session.dap
				.request("configurationDone")
				.catch((error) => this.fail(session, error));
		} else if (
			event === "dart.serviceExtensionAdded" &&
			body.extensionRPC === "ext.flutter.inspector.show" &&
			typeof body.isolateId === "string"
		) {
			session.inspectorIsolate = body.isolateId;
		} else if (event === "output")
			this.output(session, String(body.output ?? ""));
		else if (event === "flutter.appStarted") {
			clearTimeout(session.startup);
			session.snapshot.phase = "running";
			session.snapshot.canReload = session.snapshot.mode === "debug";
		} else if (
			event === "dart.debuggerUris" &&
			typeof body.vmServiceUri === "string"
		) {
			session.vmUri = body.vmServiceUri;
			session.snapshot.canInspect = session.snapshot.mode === "debug";
			this.listenVm(session, body.vmServiceUri);
		} else if (event === "dart.toolEvent" && body.kind === "navigate")
			void this.navigate(session, (body.data ?? {}) as Record<string, unknown>);
		else if (event === "dart.navigate") void this.navigate(session, body);
		else if (event === "terminated" || event === "exited")
			void this.stop(session.snapshot.workspaceId, session.snapshot.id);
	}
	private listenVm(session: Session, uri: string) {
		session.vm?.close();
		session.vm = new DtdConnection(
			uri,
			() => {},
			(message) => {
				const params = message.params as Record<string, unknown> | undefined;
				const event = params?.event as Record<string, unknown> | undefined;
				if (event?.kind === "navigate")
					void this.navigate(
						session,
						(event.extensionData ?? {}) as Record<string, unknown>,
					);
			},
		);
		void session.vm
			.call("streamListen", { streamId: "ToolEvent" })
			.catch(() => {});
	}
	private async navigate(
		session: Session,
		data: Record<string, unknown>,
		strict = false,
	) {
		const sequence = ++session.generation;
		const uri = data.resolvedFileUri ?? data.fileUri ?? data.uri ?? data.file;
		const line = Number(data.line ?? 1),
			column = Number(data.column ?? 1);
		if (
			typeof uri !== "string" ||
			!uri.startsWith("file:") ||
			!Number.isInteger(line) ||
			line < 1 ||
			!Number.isInteger(column) ||
			column < 1
		) {
			if (strict) throw new Error("Invalid source location");
			return;
		}
		try {
			const path = fileURLToPath(uri);
			if (
				!within(session.root, path) ||
				!within(await realpath(session.root), await realpath(path))
			) {
				if (strict) throw new Error("Source is outside workspace");
				return;
			}
			if (
				session.generation !== sequence ||
				this.sessions.get(session.snapshot.workspaceId) !== session ||
				!session.snapshot.canInspect
			)
				return;
			if (
				session.snapshot.location?.path === path &&
				session.snapshot.location.line === line &&
				session.snapshot.location.column === column
			)
				return;
			session.snapshot.location = { sequence, path, line, column };
		} catch (error) {
			if (strict) throw error;
		}
	}
	async control(
		workspaceId: string,
		id: string,
		action: FlutterAction,
		reason: "manual" | "save" = "manual",
	) {
		const session = this.sessions.get(workspaceId);
		if (!session || session.snapshot.id !== id)
			throw new Error("Flutter session no longer exists");
		if (action === "stop") {
			await this.stop(workspaceId, id);
			return;
		}
		if (session.snapshot.phase !== "running")
			throw new Error("Flutter session is busy or not running");
		if (action === "select-widget") {
			if (!session.snapshot.canInspect)
				throw new Error("Widget inspection is unavailable");
			if (!session.inspectorIsolate)
				throw new Error("Flutter Inspector extension is not ready");
			const enabled = !session.snapshot.selectingWidget;
			await session.dap.request("callService", {
				method: "ext.flutter.inspector.show",
				params: {
					enabled: String(enabled),
					isolateId: session.inspectorIsolate,
				},
			});
			session.snapshot.selectingWidget = enabled;
			return;
		}
		if (!session.snapshot.canReload)
			throw new Error("Hot reload/restart requires a debug session");
		if (action === "restart") {
			session.inspectorIsolate = undefined;
			session.snapshot.selectingWidget = false;
		}
		session.snapshot.phase = action === "reload" ? "reloading" : "restarting";
		try {
			await session.dap.request(
				action === "reload" ? "hotReload" : "hotRestart",
				{ reason },
				60_000,
			);
		} finally {
			if (
				this.sessions.get(workspaceId) === session &&
				!session.stopping &&
				["reloading", "restarting"].includes(
					this.snapshot(workspaceId)?.phase ?? "",
				)
			)
				session.snapshot.phase = "running";
		}
	}
	async inspector(workspaceId: string, id: string): Promise<string> {
		const session = this.sessions.get(workspaceId);
		if (
			!session ||
			session.snapshot.id !== id ||
			!session.snapshot.canInspect ||
			!session.vmUri
		)
			throw new Error("Inspector requires a running Flutter debug session");
		if (session.inspectorUrl) return session.inspectorUrl;
		if (session.inspectorTask) return session.inspectorTask;
		session.inspectorTask = this.startInspector(session).catch(
			async (error) => {
				await this.servicesStop(session, false);
				session.inspectorTask = undefined;
				throw error;
			},
		);
		return session.inspectorTask;
	}
	private async startInspector(session: Session) {
		const daemon = new ToolService(
			session.sdk.dart,
			["tooling-daemon", "--machine"],
			session.resolved.cwd,
			session.resolved.env,
		);
		session.dtd = daemon;
		const dtdUri = await daemon.wait((message) => {
			const details = message.tooling_daemon_details as
				| Record<string, unknown>
				| undefined;
			if (typeof details?.uri === "string") {
				return details.uri;
			}
			return undefined;
		});
		session.dtdConnection = new DtdConnection(dtdUri, async (params) => {
			await this.navigate(session, params, true);
		});
		await session.dtdConnection.call("registerService", {
			service: "Editor",
			method: "navigateToCode",
			capabilities: {},
		});
		const devtools = new ToolService(
			session.sdk.dart,
			[
				"devtools",
				"--machine",
				"--host=127.0.0.1",
				"--port=0",
				"--no-launch-browser",
				`--dtd-uri=${dtdUri}`,
			],
			session.resolved.cwd,
			session.resolved.env,
		);
		session.devtools = devtools;
		const base = await devtools.wait((message) => {
			if (
				message.event !== "server.started" &&
				message.method !== "server.started"
			)
				return undefined;
			const params = message.params as Record<string, unknown> | undefined;
			return params?.port ? `http://127.0.0.1:${params.port}/` : undefined;
		});
		if (session.stopping || !session.snapshot.canInspect)
			throw new Error("Flutter session stopped during Inspector startup");
		const url = new URL("inspector", base);
		url.searchParams.set("uri", session.vmUri ?? "");
		url.searchParams.set("embed", "true");
		url.searchParams.set("ide", "Superset");
		url.searchParams.set("dtdUri", dtdUri);
		session.inspectorUrl = url.toString();
		return session.inspectorUrl;
	}
	private async servicesStop(session: Session, includeVm = true) {
		if (includeVm) session.vm?.close();
		session.dtdConnection?.close();
		await Promise.allSettled([session.devtools?.stop(), session.dtd?.stop()]);
		session.inspectorUrl = undefined;
	}
	async stop(workspaceId: string, id?: string, cancelStart = true) {
		if (cancelStart && this.starting.has(workspaceId))
			this.cancelledStarts.add(workspaceId);
		const session = this.sessions.get(workspaceId);
		if (!session || (id && session.snapshot.id !== id)) return;
		if (session.stopping) return session.stopping;
		session.snapshot.phase = "stopping";
		session.snapshot.canInspect = false;
		session.snapshot.canReload = false;
		clearTimeout(session.startup);
		session.stopping = (async () => {
			await session.dap.stop();
			await this.servicesStop(session);
			session.snapshot.phase = "exited";
		})();
		return session.stopping;
	}
	async stopWorkspace(workspaceId: string) {
		const session = this.sessions.get(workspaceId);
		await this.stop(workspaceId);
		if (this.sessions.get(workspaceId) === session)
			this.sessions.delete(workspaceId);
	}
	async dispose() {
		this.disposed = true;
		await Promise.allSettled(
			[...this.discovery].map((child) =>
				child.pid
					? treeKillWithEscalation({ pid: child.pid, escalationTimeoutMs: 500 })
					: undefined,
			),
		);
		this.discovery.clear();
		await Promise.allSettled(
			[...this.sessions.keys()].map((id) => this.stop(id)),
		);
	}
}
