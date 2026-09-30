import { setDiagnostics } from "@codemirror/lint";
import { LSPClient, LSPPlugin } from "@codemirror/lsp-client";
import type { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
	DEFAULT_EDITOR_SETTINGS,
	type EditorSettings,
	resolveEditorSettings,
} from "@superset/shared/editor-settings";
import {
	detectLspLanguage,
	filePathToLspUri,
	type LspServerId,
	type LspState,
} from "@superset/shared/lsp";
import type { WorkspaceClientContextValue } from "@superset/workspace-client";
import DOMPurify from "dompurify";
import { detectLanguage } from "shared/detect-language";
import type {
	DocumentDiagnosticParams,
	DocumentDiagnosticReport,
	DocumentFormattingParams,
	TextEdit,
} from "vscode-languageserver-protocol";
import type { SharedFileDocument } from "../fileDocumentStore";
import { languageFeatures, publishDiagnostics } from "./extensions";
import { applyFormatEdits } from "./formatEdits";
import { inlayHints, refreshHints } from "./inlayHints";
import { LspWorkspace } from "./LspWorkspace";
import { LspTransport } from "./transport";

export type EditorLspStatus = {
	state: LspState;
	serverId: LspServerId;
	error?: string;
} | null;
type Binding = {
	document: SharedFileDocument;
	view: EditorView;
	compartment: Compartment;
	status: (status: EditorLspStatus) => void;
	session?: Session;
	active: boolean;
};
type Session = {
	key: string;
	serverId: LspServerId;
	rootUri: string;
	bindings: Set<Binding>;
	client?: LSPClient;
	workspace?: LspWorkspace;
	socket?: WebSocket;
	transport?: LspTransport;
	sessionId?: string;
	attempt: number;
	timer?: ReturnType<typeof setTimeout>;
	connecting?: Promise<void>;
	disposed: boolean;
	diagnostics: Map<
		string,
		{ version: number; resultId?: string; params?: DocumentDiagnosticParams }
	>;
};

export class LspCoordinator {
	private preferences = DEFAULT_EDITOR_SETTINGS;
	private diagnosticListeners = new Set<() => void>();
	private diagnosticCounts = new Map<
		string,
		{ errors: number; warnings: number }
	>();
	private diagnosticVersion = 0;
	subscribeDiagnostics = (listener: () => void) => {
		this.diagnosticListeners.add(listener);
		return () => {
			this.diagnosticListeners.delete(listener);
		};
	};
	getDiagnosticVersion = () => this.diagnosticVersion;
	getDiagnostics() {
		return this.diagnosticCounts;
	}
	private diagnosticsChanged() {
		this.diagnosticVersion++;
		for (const listener of this.diagnosticListeners) listener();
	}
	configure(preferences: EditorSettings) {
		const previous = this.preferences;
		this.preferences = preferences;
		for (const session of this.sessions.values())
			for (const binding of session.bindings) {
				if (!binding.active || !session.client) continue;
				const language = detectLanguage(binding.document.absolutePath);
				const before = resolveEditorSettings(previous, language);
				const after = resolveEditorSettings(preferences, language);
				if (
					before.enableLanguageServer === after.enableLanguageServer &&
					JSON.stringify(before.hints) === JSON.stringify(after.hints)
				)
					continue;
				if (!after.enableLanguageServer) {
					this.diagnosticCounts.delete(
						filePathToLspUri(binding.document.absolutePath),
					);
					this.diagnosticsChanged();
				}
				binding.view.dispatch({ effects: binding.compartment.reconfigure([]) });
				this.install(binding, session);
			}
	}
	async formatDocument(
		document: SharedFileDocument,
		content: string,
		editing: { tabSize: number; hardTabs: boolean },
	): Promise<string> {
		const binding = [...this.bindings].find(
			(binding) => binding.document.id === document.id && binding.active,
		);
		const client = binding?.session?.client;
		if (!client?.serverCapabilities?.documentFormattingProvider)
			throw new Error("Formatting is not available");
		client.sync();
		const params: DocumentFormattingParams = {
			textDocument: { uri: filePathToLspUri(document.absolutePath) },
			options: { tabSize: editing.tabSize, insertSpaces: !editing.hardTabs },
		};
		const edits = await client.request<
			DocumentFormattingParams,
			TextEdit[] | null
		>("textDocument/formatting", params);
		return applyFormatEdits(content, edits ?? []);
	}
	private sessions = new Map<string, Session>();
	private bindings = new Set<Binding>();
	private views = new Map<string, Set<EditorView>>();
	private disposed = false;

	constructor(
		private workspaceId: string,
		private connection: WorkspaceClientContextValue,
		private openFile: (path: string) => void,
		private uriToPath: (uri: string) => string | null,
	) {}

	registerView(path: string, view: EditorView) {
		const uri = filePathToLspUri(path);
		const views = this.views.get(uri) ?? new Set();
		views.add(view);
		this.views.set(uri, views);
		return () => {
			views.delete(view);
			if (!views.size) this.views.delete(uri);
		};
	}

	attach(
		document: SharedFileDocument,
		view: EditorView,
		compartment: Compartment,
		status: Binding["status"],
	) {
		const binding: Binding = {
			document,
			view,
			compartment,
			status,
			active: true,
		};
		this.bindings.add(binding);
		void this.resolve(binding);
		return () => {
			binding.active = false;
			this.bindings.delete(binding);
			const session = binding.session;
			if (!session) return;
			session.bindings.delete(binding);
			if (!session.bindings.size) {
				if (session.timer) clearTimeout(session.timer);
				session.timer = setTimeout(() => this.stop(session), 60_000);
			}
		};
	}

	private async resolve(binding: Binding) {
		const language = detectLspLanguage(binding.document.absolutePath);
		if (!language || this.disposed) return;
		binding.status({ state: "starting", serverId: language.serverId });
		try {
			const resolved = await this.connection.trpcClient.lsp.resolve.mutate({
				workspaceId: this.workspaceId,
				absolutePath: binding.document.absolutePath,
			});
			if (!resolved) {
				binding.status(null);
				return;
			}
			if (!binding.active || this.disposed) {
				if (resolved.sessionId)
					void this.connection.trpcClient.lsp.release
						.mutate({ sessionId: resolved.sessionId })
						.catch(() => {});
				return;
			}
			if (!resolved.sessionId) {
				binding.status({ state: resolved.state, serverId: language.serverId });
				return;
			}
			const key = `${resolved.serverId}:${resolved.rootUri}`;
			let session = this.sessions.get(key);
			const existingSession = !!session;
			if (session) {
				void this.connection.trpcClient.lsp.release
					.mutate({ sessionId: resolved.sessionId })
					.catch(() => {});
				if (session.timer) clearTimeout(session.timer);
			} else {
				session = {
					key,
					serverId: resolved.serverId,
					rootUri: resolved.rootUri,
					bindings: new Set(),
					attempt: 0,
					disposed: false,
					diagnostics: new Map(),
				};
				this.sessions.set(key, session);
			}
			binding.session = session;
			session.bindings.add(binding);
			if (!session.client && !session.connecting)
				session.connecting = this.connect(
					session,
					existingSession ? undefined : resolved.sessionId,
				);
			await session.connecting;
			if (session.client && binding.active) this.install(binding, session);
		} catch (error) {
			if (binding.active)
				binding.status({
					state: "failed",
					serverId: language.serverId,
					error: error instanceof Error ? error.message : String(error),
				});
		}
	}

	private async connect(session: Session, sessionId?: string) {
		this.updateStatus(session, "starting");
		try {
			if (!sessionId) {
				const binding = [...session.bindings][0];
				if (!binding) return;
				const result = await this.connection.trpcClient.lsp.resolve.mutate({
					workspaceId: this.workspaceId,
					absolutePath: binding.document.absolutePath,
				});
				if (!result?.sessionId) {
					this.updateStatus(session, result?.state ?? "failed");
					return;
				}
				sessionId = result.sessionId;
			}
			if (session.disposed || this.disposed) {
				void this.connection.trpcClient.lsp.release
					.mutate({ sessionId })
					.catch(() => {});
				return;
			}
			session.sessionId = sessionId;
			const url = new URL(
				`${this.connection.hostUrl.replace(/\/$/, "")}/lsp/${sessionId}`,
			);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			const token = this.connection.getWsToken();
			if (token) url.searchParams.set("token", token);
			const socket = new WebSocket(url);
			session.socket = socket;
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					socket.close();
					reject(new Error("Language server connection timed out"));
				}, 10_000);
				socket.addEventListener(
					"open",
					() => {
						clearTimeout(timer);
						resolve();
					},
					{ once: true },
				);
				socket.addEventListener(
					"error",
					() => {
						clearTimeout(timer);
						reject(new Error("Language server connection failed"));
					},
					{ once: true },
				);
			});
			if (session.disposed) {
				socket.close();
				return;
			}
			const transport = new LspTransport(socket);
			const client = new LSPClient({
				rootUri: session.rootUri,
				timeout: 125_000,
				sanitizeHTML: (html) => DOMPurify.sanitize(html),
				workspace: (instance) =>
					new LspWorkspace(
						instance,
						(uri) => this.navigate(uri),
						() => this.pullDiagnostics(session),
					),
				notificationHandlers: {
					"superset/inlayHintRefresh": () => {
						for (const binding of session.bindings)
							if (binding.active)
								binding.view.dispatch({ effects: refreshHints.of(null) });
						return true;
					},
					"superset/editorCapability": (instance, input: unknown) => {
						if (
							instance.serverCapabilities &&
							input &&
							typeof input === "object"
						) {
							const method = Reflect.get(input, "method");
							const enabled = Reflect.get(input, "enabled") === true;
							if (method === "textDocument/formatting")
								instance.serverCapabilities.documentFormattingProvider =
									enabled;
							if (method === "textDocument/inlayHint") {
								instance.serverCapabilities.inlayHintProvider = enabled;
								for (const binding of session.bindings)
									if (binding.active)
										binding.view.dispatch({ effects: refreshHints.of(null) });
							}
						}
						return true;
					},
					"textDocument/publishDiagnostics": (instance, params: unknown) => {
						if (params && typeof params === "object") {
							const uri: unknown = Reflect.get(params, "uri");
							const version: unknown = Reflect.get(params, "version");
							const file =
								typeof uri === "string"
									? instance.workspace.getFile(uri)
									: null;
							if (!file || version === undefined || version === file.version)
								this.recordDiagnostics(params);
						}
						return publishDiagnostics(instance, params);
					},
					"superset/diagnosticRefresh": () => {
						session.diagnostics.clear();
						this.pullDiagnostics(session);
						return true;
					},
					"superset/diagnosticUnregistration": (instance) => {
						if (instance.serverCapabilities)
							instance.serverCapabilities.diagnosticProvider = undefined;
						session.diagnostics.clear();
						for (const binding of session.bindings)
							if (binding.active)
								binding.view.dispatch(setDiagnostics(binding.view.state, []));
						return true;
					},
					"superset/diagnosticRegistration": (instance, params: unknown) => {
						if (
							instance.serverCapabilities &&
							params &&
							typeof params === "object"
						)
							instance.serverCapabilities.diagnosticProvider = {
								interFileDependencies: true,
								workspaceDiagnostics: false,
							};
						this.pullDiagnostics(session);
						return true;
					},
				},
			});
			session.transport = transport;
			session.client = client;
			session.workspace =
				client.workspace instanceof LspWorkspace ? client.workspace : undefined;
			socket.addEventListener(
				"close",
				() => {
					if (session.socket === socket) this.disconnected(session);
				},
				{
					once: true,
				},
			);
			client.connect(transport);
			await client.initializing;
			if (session.disposed || socket.readyState !== WebSocket.OPEN) return;
			for (const binding of session.bindings) this.install(binding, session);
			this.updateStatus(session, "running");
		} catch (error) {
			this.updateStatus(
				session,
				"failed",
				error instanceof Error ? error.message : String(error),
			);
			this.disconnected(session);
		} finally {
			session.connecting = undefined;
		}
	}

	private install(binding: Binding, session: Session) {
		if (!binding.active || !session.client || !session.workspace) return;
		if (LSPPlugin.get(binding.view)?.client === session.client) return;
		const language = detectLspLanguage(binding.document.absolutePath);
		if (!language) return;
		const preferences = resolveEditorSettings(
			this.preferences,
			detectLanguage(binding.document.absolutePath),
		);
		if (!preferences.enableLanguageServer) return;
		session.workspace.register(binding.document);
		binding.view.dispatch({
			effects: binding.compartment.reconfigure([
				session.client.plugin(
					filePathToLspUri(binding.document.absolutePath),
					language.languageId,
				),
				languageFeatures((uri) => this.navigate(uri)),
				inlayHints(preferences.hints),
			]),
		});
		binding.status({ state: "running", serverId: session.serverId });
	}
	private recordDiagnostics(input: unknown) {
		if (!input || typeof input !== "object") return;
		const uri: unknown = Reflect.get(input, "uri");
		const diagnostics: unknown = Reflect.get(input, "diagnostics");
		if (typeof uri !== "string" || !Array.isArray(diagnostics)) return;
		const counts = { errors: 0, warnings: 0 };
		for (const diagnostic of diagnostics)
			if (diagnostic && typeof diagnostic === "object") {
				if (Reflect.get(diagnostic, "severity") === 2) counts.warnings++;
				else if (
					Reflect.get(diagnostic, "severity") === 1 ||
					Reflect.get(diagnostic, "severity") === undefined
				)
					counts.errors++;
			}
		if (counts.errors || counts.warnings)
			this.diagnosticCounts.set(uri, counts);
		else this.diagnosticCounts.delete(uri);
		this.diagnosticsChanged();
	}

	private pullDiagnostics(session: Session) {
		const client = session.client;
		if (!client?.serverCapabilities?.diagnosticProvider || session.disposed)
			return;
		const openUris = new Set(client.workspace.files.map((file) => file.uri));
		const dependenciesChanged =
			client.serverCapabilities.diagnosticProvider.interFileDependencies &&
			client.workspace.files.some(
				(file) => session.diagnostics.get(file.uri)?.version !== file.version,
			);
		for (const uri of session.diagnostics.keys())
			if (!openUris.has(uri)) session.diagnostics.delete(uri);
		for (const file of client.workspace.files) {
			const previous = session.diagnostics.get(file.uri);
			if (previous?.version === file.version && !dependenciesChanged) continue;
			if (previous?.params) client.cancelRequest(previous.params);
			const version = file.version;
			session.diagnostics.set(file.uri, {
				version,
				resultId: previous?.resultId,
			});
			const params: DocumentDiagnosticParams = {
				textDocument: { uri: file.uri },
				previousResultId: previous?.resultId,
			};
			session.diagnostics.set(file.uri, {
				version,
				resultId: previous?.resultId,
				params,
			});
			void client
				.request<DocumentDiagnosticParams, DocumentDiagnosticReport>(
					"textDocument/diagnostic",
					params,
				)
				.then((report) => {
					if (
						session.client !== client ||
						file.version !== version ||
						session.diagnostics.get(file.uri)?.params !== params
					)
						return;
					session.diagnostics.set(file.uri, {
						version,
						resultId: report.resultId,
					});
					if (report.kind === "full") {
						this.recordDiagnostics({
							uri: file.uri,
							diagnostics: report.items,
						});
						publishDiagnostics(client, {
							uri: file.uri,
							version,
							diagnostics: report.items,
						});
					}
				})
				.catch((error) => {
					if (
						session.client === client &&
						session.diagnostics.get(file.uri)?.params === params
					) {
						session.diagnostics.delete(file.uri);
						console.error("[lsp] Pull diagnostics failed", error);
					}
				});
		}
	}

	private disconnected(session: Session) {
		if (!session.client && session.timer) return;
		const socket = session.socket;
		session.socket = undefined;
		socket?.close();
		session.transport?.dispose();
		session.client?.disconnect();
		for (const binding of session.bindings)
			if (binding.active) {
				binding.view.dispatch({ effects: binding.compartment.reconfigure([]) });
				binding.view.dispatch(setDiagnostics(binding.view.state, []));
			}
		session.workspace?.dispose();
		session.client = undefined;
		session.workspace = undefined;
		session.diagnostics.clear();
		for (const binding of session.bindings)
			this.diagnosticCounts.delete(
				filePathToLspUri(binding.document.absolutePath),
			);
		this.diagnosticsChanged();
		if (session.disposed || this.disposed) return;
		this.updateStatus(session, "failed");
		if (session.attempt >= 2 || !session.bindings.size) return;
		session.attempt++;
		session.timer = setTimeout(
			() => {
				session.timer = undefined;
				session.connecting = this.connect(session);
			},
			session.attempt === 1 ? 1000 : 5000,
		);
	}

	private updateStatus(session: Session, state: LspState, error?: string) {
		for (const binding of session.bindings)
			if (binding.active)
				binding.status({ state, serverId: session.serverId, error });
	}

	async retry(document: SharedFileDocument) {
		const bindings = [...this.bindings].filter(
			(binding) => binding.document.id === document.id,
		);
		const session = bindings[0]?.session;
		if (session) {
			session.attempt = 0;
			if (session.timer) clearTimeout(session.timer);
			session.timer = undefined;
			session.connecting = this.connect(session);
			await session.connecting;
			return;
		}
		await Promise.all(bindings.map((binding) => this.resolve(binding)));
	}

	private async navigate(uri: string) {
		const path = this.uriToPath(uri);
		if (!path) return null;
		this.openFile(path);
		for (let attempt = 0; attempt < 100; attempt++) {
			if (this.disposed) return null;
			const view = this.views.get(uri)?.values().next().value;
			if (view) return view;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return null;
	}

	private stop(session: Session) {
		session.disposed = true;
		if (session.timer) clearTimeout(session.timer);
		session.transport?.dispose();
		session.client?.disconnect();
		session.workspace?.dispose();
		session.socket?.close();
		if (session.sessionId)
			void this.connection.trpcClient.lsp.release
				.mutate({ sessionId: session.sessionId })
				.catch(() => {});
		this.sessions.delete(session.key);
	}

	dispose() {
		this.disposed = true;
		for (const session of this.sessions.values()) this.stop(session);
		this.views.clear();
	}
}
