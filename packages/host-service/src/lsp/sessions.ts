import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	detectLspLanguage,
	filePathToLspUri,
	LSP_SERVER_IDS,
	type LspServerId,
	type LspState,
	lspUriToFilePath,
} from "@superset/shared/lsp";
import type { FsWatchEvent } from "@superset/workspace-fs/host";
import {
	Message,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { z } from "zod";
import type { HostDb } from "../db";
import { treeKillWithEscalation } from "../ports/tree-kill";
import type { WorkspaceFilesystemManager } from "../runtime/filesystem";
import { getTerminalBaseEnv, waitForTerminalBaseEnv } from "../terminal/env";
import { type LspLaunch, resolveLspLaunch } from "./adapters";
import { readLspSettings } from "./settings";

const IDLE_MS = 60_000;
const NO_DOCUMENTS_IDLE_MS = 10 * 60_000;
const SHUTDOWN_MS = 5_000;
const MAX_SESSIONS = 128;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const messageSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.number(), z.string(), z.null()]).optional(),
	method: z.string().optional(),
	params: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.unknown().optional(),
});
const registrationSchema = z.object({
	registrations: z.array(
		z.object({
			id: z.string(),
			method: z.string(),
			registerOptions: z.unknown().optional(),
		}),
	),
});
const configurationSchema = z.object({
	items: z.array(z.object({ section: z.string().optional() })),
});

export type LspSocket = {
	send(data: string): void;
	close(code?: number, reason?: string): void;
};
type Session = {
	id: string;
	workspaceId: string;
	launch: LspLaunch;
	state: LspState;
	error: string | null;
	child?: ChildProcessWithoutNullStreams;
	reader?: StreamMessageReader;
	writer?: StreamMessageWriter;
	socket?: LspSocket;
	idle?: ReturnType<typeof setTimeout>;
	documents: Set<string>;
	watch?: AsyncIterator<{ events: FsWatchEvent[] }>;
	registrations: Map<string, string>;
	shutdownResolve?: () => void;
	initialized: boolean;
	stopping?: Promise<void>;
};

function writeMessage(
	writer: StreamMessageWriter | undefined,
	message: Message & Record<string, unknown>,
): Promise<void> {
	return writer?.write(message) ?? Promise.resolve();
}

export function getConfigurationSection(
	configuration: Record<string, unknown>,
	section?: string,
): unknown {
	if (!section) return configuration;
	let value: unknown = configuration;
	for (const part of section.split(".")) {
		if (!value || typeof value !== "object" || !(part in value)) return null;
		value = Reflect.get(value, part);
	}
	return value;
}

export class LspSessions {
	private sessions = new Map<string, Session>();
	private disposed = false;

	constructor(
		private options: { db: HostDb; filesystem: WorkspaceFilesystemManager },
	) {}

	async resolve(workspaceId: string, absolutePath: string) {
		if (this.disposed) throw new Error("LSP host is shutting down");
		const root = this.options.filesystem.resolveWorkspaceRoot(workspaceId);
		await waitForTerminalBaseEnv();
		const settings = readLspSettings(this.options.db);
		const language = detectLspLanguage(absolutePath);
		if (!language) return null;
		const launch = await resolveLspLaunch(
			root,
			absolutePath,
			settings.servers[language.serverId],
			getTerminalBaseEnv(),
		);
		if (!launch) return null;
		const state: LspState = !launch.settings.enabled
			? "disabled"
			: launch.command
				? "starting"
				: "missing";
		if (state !== "starting")
			return {
				sessionId: null,
				serverId: launch.serverId,
				languageId: launch.languageId,
				rootUri: filePathToLspUri(launch.rootPath),
				state,
			};
		if (this.sessions.size >= MAX_SESSIONS)
			throw new Error("Too many language server sessions");
		const session: Session = {
			id: randomUUID(),
			workspaceId,
			launch,
			state,
			error: null,
			documents: new Set(),
			registrations: new Map(),
			initialized: false,
		};
		this.sessions.set(session.id, session);
		this.scheduleIdle(session);
		return {
			sessionId: session.id,
			serverId: launch.serverId,
			languageId: launch.languageId,
			rootUri: filePathToLspUri(launch.rootPath),
			state,
		};
	}

	status() {
		return [...this.sessions.values()].map((session) => ({
			sessionId: session.id,
			workspaceId: session.workspaceId,
			serverId: session.launch.serverId,
			rootPath: session.launch.rootPath,
			state: session.state,
			error: session.error,
		}));
	}

	has(id: string): boolean {
		return this.sessions.has(id);
	}

	async availability() {
		await waitForTerminalBaseEnv();
		const settings = readLspSettings(this.options.db);
		const extensions: Record<LspServerId, string> = {
			typescript: "ts",
			dart: "dart",
			kotlin: "kt",
			json: "json",
			xml: "xml",
			yaml: "yaml",
		};
		return Promise.all(
			LSP_SERVER_IDS.map(async (serverId) => {
				const launch = await resolveLspLaunch(
					homedir(),
					join(homedir(), `superset-lsp.${extensions[serverId]}`),
					settings.servers[serverId],
					getTerminalBaseEnv(),
				);
				return {
					serverId,
					installed: !!launch?.command,
					command: launch?.command ?? null,
				};
			}),
		);
	}

	attach(id: string, socket: LspSocket): boolean {
		const session = this.sessions.get(id);
		if (
			!session ||
			session.socket ||
			session.stopping ||
			!session.launch.command
		) {
			socket.close(1008, "Session unavailable");
			return false;
		}
		session.socket = socket;
		if (session.idle) clearTimeout(session.idle);
		const child = spawn(session.launch.command, session.launch.arguments, {
			cwd: session.launch.rootPath,
			env: session.launch.env,
			stdio: "pipe",
			shell: false,
		});
		session.child = child;
		session.reader = new StreamMessageReader(child.stdout);
		session.writer = new StreamMessageWriter(child.stdin);
		session.reader.listen((message) => {
			void this.receiveServerMessage(session, message).catch(async (error) => {
				if (Message.isRequest(message))
					await writeMessage(session.writer, {
						jsonrpc: "2.0",
						id: message.id,
						error: {
							code: -32603,
							message: error instanceof Error ? error.message : String(error),
						},
					}).catch(() => {});
				else this.fail(session, error);
			});
		});
		session.reader.onError((error) => this.fail(session, error));
		session.writer.onError(([error]) => this.fail(session, error));
		child.stderr.on("data", (chunk: Buffer) => {
			session.error = chunk.toString("utf8").slice(-4096);
		});
		child.on("error", (error) => this.fail(session, error));
		child.on("exit", (code, signal) => {
			if (!session.stopping)
				this.fail(
					session,
					new Error(`Language server exited (${code ?? signal})`),
				);
			session.shutdownResolve?.();
		});
		this.scheduleIdle(session, 120_000);
		return true;
	}

	async receive(id: string, data: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session?.writer || session.stopping) return;
		if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES)
			throw new Error("LSP message exceeds size limit");
		const parsed = messageSchema.parse(JSON.parse(data));
		if (!parsed.method) return;
		const params =
			parsed.params && typeof parsed.params === "object" ? parsed.params : {};
		if (parsed.method === "initialize") {
			const rootUri = filePathToLspUri(session.launch.rootPath);
			const capabilities = z
				.record(z.string(), z.unknown())
				.parse(Reflect.get(params, "capabilities") ?? {});
			const workspace = z
				.record(z.string(), z.unknown())
				.parse(capabilities.workspace ?? {});
			const textDocument = z
				.record(z.string(), z.unknown())
				.parse(capabilities.textDocument ?? {});
			await writeMessage(session.writer, {
				...parsed,
				params: {
					...params,
					rootUri,
					rootPath: session.launch.rootPath,
					workspaceFolders: [{ uri: rootUri, name: session.launch.rootPath }],
					initializationOptions: session.launch.settings.initializationOptions,
					capabilities: {
						...capabilities,
						general: { positionEncodings: ["utf-16"] },
						workspace: {
							...workspace,
							configuration: true,
							workspaceFolders: true,
							didChangeWatchedFiles: { dynamicRegistration: true },
							applyEdit: false,
							diagnostics: { refreshSupport: true },
						},
						textDocument: {
							completion: textDocument.completion,
							hover: textDocument.hover,
							formatting: {},
							inlayHint: {
								dynamicRegistration: true,
								resolveSupport: { properties: ["tooltip"] },
							},
							definition: textDocument.definition,
							publishDiagnostics: { versionSupport: true },
							diagnostic: {
								dynamicRegistration: true,
								relatedDocumentSupport: false,
							},
							synchronization: { didSave: true },
						},
						window: { workDoneProgress: true },
					},
				},
			});
			return;
		}
		if (parsed.method === "initialized") {
			session.initialized = true;
			session.state = "running";
			session.error = null;
			await writeMessage(session.writer, parsed);
			await writeMessage(session.writer, {
				jsonrpc: "2.0",
				method: "workspace/didChangeConfiguration",
				params: { settings: session.launch.settings.configuration },
			});
			return;
		}
		if (
			parsed.method === "textDocument/didOpen" ||
			parsed.method === "textDocument/didClose"
		) {
			const uri = z
				.object({ textDocument: z.object({ uri: z.string() }) })
				.parse(params).textDocument.uri;
			if (parsed.method === "textDocument/didOpen") session.documents.add(uri);
			else session.documents.delete(uri);
			if (session.documents.size > 0 && session.idle)
				clearTimeout(session.idle);
			if (session.documents.size === 0)
				this.scheduleIdle(session, NO_DOCUMENTS_IDLE_MS);
		}
		await writeMessage(session.writer, parsed);
	}

	private async receiveServerMessage(session: Session, message: Message) {
		if (Message.isResponse(message) && message.id === "superset-shutdown") {
			session.shutdownResolve?.();
			return;
		}
		if (Message.isRequest(message)) {
			let result: unknown = null;
			if (message.method === "workspace/configuration") {
				result = configurationSchema
					.parse(message.params)
					.items.map((item) =>
						getConfigurationSection(
							session.launch.settings.configuration,
							item.section,
						),
					);
			} else if (message.method === "workspace/workspaceFolders") {
				result = [
					{
						uri: filePathToLspUri(session.launch.rootPath),
						name: session.launch.rootPath,
					},
				];
			} else if (message.method === "client/registerCapability") {
				for (const registration of registrationSchema.parse(message.params)
					.registrations) {
					session.registrations.set(registration.id, registration.method);
					if (
						registration.method === "textDocument/inlayHint" ||
						registration.method === "textDocument/formatting"
					)
						session.socket?.send(
							JSON.stringify({
								jsonrpc: "2.0",
								method: "superset/editorCapability",
								params: { method: registration.method, enabled: true },
							}),
						);
					if (registration.method === "textDocument/diagnostic")
						session.socket?.send(
							JSON.stringify({
								jsonrpc: "2.0",
								method: "superset/diagnosticRegistration",
								params: registration.registerOptions,
							}),
						);
				}
				if (
					[...session.registrations.values()].includes(
						"workspace/didChangeWatchedFiles",
					)
				)
					this.startWatch(session);
			} else if (message.method === "client/unregisterCapability") {
				const registrations = z
					.object({ unregisterations: z.array(z.object({ id: z.string() })) })
					.parse(message.params);
				let diagnosticRemoved = false;
				for (const registration of registrations.unregisterations) {
					const method = session.registrations.get(registration.id);
					if (
						method === "textDocument/inlayHint" ||
						method === "textDocument/formatting"
					)
						session.socket?.send(
							JSON.stringify({
								jsonrpc: "2.0",
								method: "superset/editorCapability",
								params: { method, enabled: false },
							}),
						);
					if (
						session.registrations.get(registration.id) ===
						"textDocument/diagnostic"
					)
						diagnosticRemoved = true;
					session.registrations.delete(registration.id);
				}
				if (
					diagnosticRemoved &&
					![...session.registrations.values()].includes(
						"textDocument/diagnostic",
					)
				)
					session.socket?.send(
						JSON.stringify({
							jsonrpc: "2.0",
							method: "superset/diagnosticUnregistration",
							params: {},
						}),
					);
			} else if (message.method === "vscode/content") {
				const uri = z.string().parse(message.params);
				const path = lspUriToFilePath(uri);
				if (path) {
					const file = await this.options.filesystem
						.getServiceForWorkspace(session.workspaceId)
						.readFile({
							absolutePath: path,
							encoding: "utf-8",
							maxBytes: MAX_MESSAGE_BYTES,
						});
					if (file.kind !== "text" || file.exceededLimit)
						throw new Error("Schema is not a supported text file");
					result = file.content;
				} else {
					const url = new URL(uri);
					if (url.protocol !== "https:" && url.protocol !== "http:")
						throw new Error("Unsupported schema URI");
					const response = await fetch(url, {
						signal: AbortSignal.timeout(10_000),
					});
					if (!response.ok)
						throw new Error(`Schema request failed (${response.status})`);
					result = await response.text();
					if (Buffer.byteLength(String(result)) > MAX_MESSAGE_BYTES)
						throw new Error("Schema exceeds size limit");
				}
			} else if (message.method === "workspace/diagnostic/refresh") {
				session.socket?.send(
					JSON.stringify({
						jsonrpc: "2.0",
						method: "superset/diagnosticRefresh",
						params: {},
					}),
				);
			} else if (message.method === "workspace/inlayHint/refresh") {
				session.socket?.send(
					JSON.stringify({
						jsonrpc: "2.0",
						method: "superset/inlayHintRefresh",
						params: {},
					}),
				);
			} else if (message.method === "workspace/applyEdit")
				result = {
					applied: false,
					failureReason: "Workspace edits are not enabled",
				};
			else if (message.method !== "window/workDoneProgress/create") {
				await writeMessage(session.writer, {
					jsonrpc: "2.0",
					id: message.id,
					error: { code: -32601, message: "Method not implemented" },
				});
				return;
			}
			await writeMessage(session.writer, {
				jsonrpc: "2.0",
				id: message.id,
				result,
			});
			return;
		}
		session.socket?.send(JSON.stringify(message));
	}

	private startWatch(session: Session) {
		if (session.watch) return;
		const root = this.options.filesystem.resolveWorkspaceRoot(
			session.workspaceId,
		);
		const iterator = this.options.filesystem
			.getServiceForWorkspace(session.workspaceId)
			.watchPath({ absolutePath: root })
			[Symbol.asyncIterator]();
		session.watch = iterator;
		void (async () => {
			try {
				while (!session.stopping) {
					const next = await iterator.next();
					if (next.done) break;
					if (
						![...session.registrations.values()].includes(
							"workspace/didChangeWatchedFiles",
						)
					)
						continue;
					const changes = next.value.events.flatMap((event) =>
						event.kind === "overflow"
							? []
							: event.kind === "rename" && event.oldAbsolutePath
								? [
										{ uri: filePathToLspUri(event.oldAbsolutePath), type: 3 },
										{ uri: filePathToLspUri(event.absolutePath), type: 1 },
									]
								: [
										{
											uri: filePathToLspUri(event.absolutePath),
											type:
												event.kind === "delete"
													? 3
													: event.kind === "create"
														? 1
														: 2,
										},
									],
					);
					if (changes.length)
						await writeMessage(session.writer, {
							jsonrpc: "2.0",
							method: "workspace/didChangeWatchedFiles",
							params: { changes },
						});
				}
			} catch (error) {
				if (!session.stopping) console.error("[lsp] File watch failed", error);
			}
		})();
	}

	private scheduleIdle(session: Session, duration = IDLE_MS) {
		if (session.idle) clearTimeout(session.idle);
		session.idle = setTimeout(() => {
			void this.stop(session.id);
		}, duration);
		session.idle.unref?.();
	}

	private fail(session: Session, error: unknown) {
		if (session.stopping) return;
		session.state = "failed";
		session.error = error instanceof Error ? error.message : String(error);
		session.socket?.close(1011, "Language server failed");
		void this.stop(session.id);
	}

	async restart(serverId: LspServerId): Promise<void> {
		await Promise.all(
			[...this.sessions.values()]
				.filter((session) => session.launch.serverId === serverId)
				.map((session) => this.stop(session.id)),
		);
	}

	async stopWorkspace(workspaceId: string): Promise<void> {
		await Promise.all(
			[...this.sessions.values()]
				.filter((session) => session.workspaceId === workspaceId)
				.map((session) => this.stop(session.id)),
		);
	}

	async stop(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) return;
		if (session.stopping) return session.stopping;
		session.stopping = Promise.resolve().then(async () => {
			if (session.idle) clearTimeout(session.idle);
			session.socket?.close(1012, "Language server stopped");
			session.socket = undefined;
			void session.watch?.return?.();
			const child = session.child;
			if (child && child.exitCode === null && child.signalCode === null) {
				if (session.initialized && session.writer) {
					let timer: ReturnType<typeof setTimeout> | undefined;
					await new Promise<void>((resolve) => {
						session.shutdownResolve = resolve;
						timer = setTimeout(resolve, SHUTDOWN_MS);
						void writeMessage(session.writer, {
							jsonrpc: "2.0",
							id: "superset-shutdown",
							method: "shutdown",
							params: null,
						}).catch(resolve);
					});
					clearTimeout(timer);
					await writeMessage(session.writer, {
						jsonrpc: "2.0",
						method: "exit",
					}).catch(() => {});
				}
				if (child.pid)
					await treeKillWithEscalation({
						pid: child.pid,
						escalationTimeoutMs: 500,
					});
			}
			session.reader?.dispose();
			session.writer?.dispose();
			this.sessions.delete(id);
		});
		return session.stopping;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
	}
}
