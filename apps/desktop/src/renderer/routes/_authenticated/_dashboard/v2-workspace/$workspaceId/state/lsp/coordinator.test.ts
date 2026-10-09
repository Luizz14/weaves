import { afterAll, afterEach, expect, test } from "bun:test";
import { diagnosticCount } from "@codemirror/lint";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	filePathToLspUri,
	lspSettingsSchema,
	lspUriToFilePath,
} from "@superset/shared/lsp";
import {
	acquireDocument,
	prefetchDocument,
	releaseDocument,
} from "../fileDocumentStore";
import { type EditorLspStatus, LspCoordinator } from "./coordinator";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const originalWebSocket = globalThis.WebSocket;
const sockets: TestSocket[] = [];
const views: EditorView[] = [];
const coordinators: LspCoordinator[] = [];

class TestSocket extends EventTarget {
	static OPEN = 1;
	readyState = 0;
	messages: {
		id?: number;
		method?: string;
		params?: { textDocument?: { version?: number } };
	}[] = [];
	constructor(_url: URL) {
		super();
		sockets.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.dispatchEvent(new Event("open"));
		});
	}
	send(data: string) {
		const message = JSON.parse(data);
		this.messages.push(message);
		if (message.method === "initialize")
			queueMicrotask(() =>
				this.receive({
					id: message.id,
					result: {
						capabilities: {
							textDocumentSync: 2,
							diagnosticProvider: {
								interFileDependencies: true,
								workspaceDiagnostics: false,
							},
						},
					},
				}),
			);
		if (message.method === "textDocument/diagnostic")
			queueMicrotask(() =>
				this.receive({
					id: message.id,
					result: {
						kind: "full",
						resultId: "1",
						items: [
							{
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: 1 },
								},
								severity: 1,
								message: "Diagnostic",
							},
						],
					},
				}),
			);
	}
	receive(message: Record<string, unknown>) {
		if (this.readyState === 1)
			this.dispatchEvent(
				new MessageEvent("message", {
					data: JSON.stringify({ jsonrpc: "2.0", ...message }),
				}),
			);
	}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.dispatchEvent(new Event("close"));
	}
}
globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
afterEach(() => {
	for (const coordinator of coordinators.splice(0)) coordinator.dispose();
	for (const view of views.splice(0)) view.destroy();
	sockets.splice(0);
});
afterAll(async () => {
	globalThis.WebSocket = originalWebSocket;
	if (!registered) await GlobalRegistrator.unregister();
});

test("shares a server across splits, pulls diagnostics and clears them on disconnect", async () => {
	const workspaceId = crypto.randomUUID();
	const path = "/workspace/a.kt";
	const document = acquireDocument(workspaceId, path, {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "val a = 1",
					revision: "1",
					byteLength: 9,
				}),
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2]);
	await Promise.resolve();
	let sessionCount = 0;
	let releases = 0;
	const connection = {
		hostUrl: "http://localhost:1234",
		getWsToken: () => "test",
		trpcClient: {
			settings: {
				lsp: { get: { query: async () => lspSettingsSchema.parse({}) } },
			},
			lsp: {
				resolve: {
					mutate: async () => ({
						sessionId: `session-${++sessionCount}`,
						serverId: "kotlin",
						languageId: "kotlin",
						rootUri: "file:///workspace",
						state: "starting",
					}),
				},
				release: {
					mutate: async () => {
						releases++;
					},
				},
			},
		},
	} as unknown as ConstructorParameters<typeof LspCoordinator>[1];
	const coordinator = new LspCoordinator(
		workspaceId,
		connection,
		() => {},
		lspUriToFilePath,
	);
	coordinators.push(coordinator);
	const statuses: EditorLspStatus[] = [];
	const detach = [];
	for (let index = 0; index < 2; index++) {
		const compartment = new Compartment();
		const view = new EditorView({
			doc: "val a = 1",
			extensions: [compartment.of([])],
		});
		views.push(view);
		detach.push(
			coordinator.attach(document, view, compartment, {
				onStatus: (status) => statuses.push(status),
			}),
		);
	}
	await waitFor(
		() => statuses.filter((status) => status?.state === "running").length >= 2,
	);
	expect(sockets).toHaveLength(1);
	expect(releases).toBe(1);
	expect(
		sockets[0].messages.filter(
			(message) => message.method === "textDocument/didOpen",
		),
	).toHaveLength(1);
	await waitFor(() => diagnosticCount(views[0].state) === 1);
	expect(diagnosticCount(views[1].state)).toBe(1);
	const lateCompartment = new Compartment();
	const lateView = new EditorView({
		doc: "val a = 1",
		extensions: [lateCompartment.of([])],
	});
	views.push(lateView);
	detach.push(
		coordinator.attach(document, lateView, lateCompartment, {
			onStatus: (status) => statuses.push(status),
		}),
	);
	await waitFor(() => diagnosticCount(lateView.state) === 1);
	expect(sockets).toHaveLength(1);
	sockets[0].receive({
		method: "superset/diagnosticUnregistration",
		params: {},
	});
	expect(diagnosticCount(views[0].state)).toBe(0);
	sockets[0].receive({ method: "superset/diagnosticRegistration", params: {} });
	await waitFor(() => diagnosticCount(views[0].state) === 1);
	sockets[0].receive({
		method: "textDocument/publishDiagnostics",
		params: { uri: filePathToLspUri(path), version: -1, diagnostics: [] },
	});
	expect(diagnosticCount(views[0].state)).toBe(1);
	sockets[0].close();
	expect(diagnosticCount(views[0].state)).toBe(0);
	expect(diagnosticCount(views[1].state)).toBe(0);
	await waitFor(
		() => sockets.length === 2 && statuses.at(-1)?.state === "running",
	);
	expect(
		sockets[1].messages.filter(
			(message) => message.method === "textDocument/didOpen",
		),
	).toHaveLength(1);
	for (const release of detach) release();
	releaseDocument(workspaceId, path);
}, 5000);

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 150; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Coordinator did not reach the expected state");
}

function statusConnection(
	resolveState: "starting" | "missing" | "disabled",
	disabled: string[] = [],
) {
	const settings = lspSettingsSchema.parse({});
	for (const serverId of disabled)
		settings.servers[serverId as keyof typeof settings.servers].enabled = false;
	return {
		hostUrl: "http://localhost:1234",
		getWsToken: () => "test",
		trpcClient: {
			settings: { lsp: { get: { query: async () => settings } } },
			lsp: {
				resolve: {
					mutate: async () => ({
						sessionId: resolveState === "starting" ? "session" : null,
						serverId: "typescript",
						languageId: "typescript",
						rootUri: "file:///workspace",
						state: resolveState,
					}),
				},
				release: { mutate: async () => {} },
			},
		},
	} as unknown as ConstructorParameters<typeof LspCoordinator>[1];
}

function statusCoordinator(connection: ReturnType<typeof statusConnection>) {
	const coordinator = new LspCoordinator(
		crypto.randomUUID(),
		connection,
		() => {},
		lspUriToFilePath,
	);
	coordinators.push(coordinator);
	return coordinator;
}

test("predicts a stable status before a file attaches", () => {
	const coordinator = statusCoordinator(statusConnection("starting"));
	const first = coordinator.getStatus("doc", "/workspace/src/a.ts");
	expect(first).toEqual({ state: "starting", serverId: "typescript" });
	expect(coordinator.getStatus("doc", "/workspace/src/a.ts")).toBe(first);
	expect(coordinator.getStatus("doc", "/workspace/README.md")).toBeNull();
});

test("remembers a missing server for the directory it was resolved in", async () => {
	const workspaceId = crypto.randomUUID();
	const path = "/workspace/src/a.ts";
	const document = acquireDocument(workspaceId, path, {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "const a = 1",
					revision: "1",
					byteLength: 11,
				}),
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2]);
	const coordinator = statusCoordinator(statusConnection("missing"));
	const view = new EditorView({ doc: "const a = 1" });
	views.push(view);
	const detach = coordinator.attach(document, view, new Compartment());
	await waitFor(
		() => coordinator.getStatus(document.id, path)?.state === "missing",
	);
	detach();
	expect(coordinator.getStatus("other", "/workspace/src/b.ts")?.state).toBe(
		"missing",
	);
	expect(coordinator.getStatus("other", "/workspace/lib/c.ts")?.state).toBe(
		"starting",
	);
	releaseDocument(workspaceId, path);
});

test("servers disabled in the host settings are predicted disabled", async () => {
	const coordinator = statusCoordinator(
		statusConnection("starting", ["typescript"]),
	);
	await waitFor(
		() => coordinator.getStatus("doc", "/workspace/a.ts")?.state === "disabled",
	);
	expect(coordinator.getStatus("doc", "/workspace/a.json")?.state).toBe(
		"starting",
	);
});

async function attachSecondFile(
	server: { serverId: string; languageId: string },
	firstPath: string,
	secondPath: string,
) {
	const workspaceId = crypto.randomUUID();
	const client = {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "val a = 1",
					revision: "1",
					byteLength: 9,
				}),
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2];
	const first = acquireDocument(workspaceId, firstPath, client);
	const second = acquireDocument(workspaceId, secondPath, client);
	await Promise.resolve();
	let resolves = 0;
	const connection = {
		hostUrl: "http://localhost:1234",
		getWsToken: () => "test",
		trpcClient: {
			settings: {
				lsp: { get: { query: async () => lspSettingsSchema.parse({}) } },
			},
			lsp: {
				resolve: {
					mutate: async () => ({
						sessionId: `session-${++resolves}`,
						...server,
						rootUri: "file:///workspace",
						state: "starting",
					}),
				},
				release: { mutate: async () => {} },
			},
		},
	} as unknown as ConstructorParameters<typeof LspCoordinator>[1];
	const coordinator = new LspCoordinator(
		workspaceId,
		connection,
		() => {},
		lspUriToFilePath,
	);
	coordinators.push(coordinator);
	const firstCompartment = new Compartment();
	const firstView = new EditorView({
		doc: "val a = 1",
		extensions: firstCompartment.of([]),
	});
	views.push(firstView);
	const detachFirst = coordinator.attach(first, firstView, firstCompartment);
	await waitFor(
		() =>
			coordinator.getStatus(first.id, first.absolutePath)?.state === "running",
	);
	const secondCompartment = new Compartment();
	const secondView = new EditorView({
		doc: "val a = 1",
		extensions: secondCompartment.of([]),
	});
	views.push(secondView);
	const detachSecond = coordinator.attach(
		second,
		secondView,
		secondCompartment,
	);
	const status = coordinator.getStatus(second.id, second.absolutePath)?.state;
	await Promise.resolve();
	await Promise.resolve();
	const didOpens = sockets[0].messages.filter(
		(message) => message.method === "textDocument/didOpen",
	).length;
	detachSecond();
	detachFirst();
	releaseDocument(workspaceId, firstPath);
	releaseDocument(workspaceId, secondPath);
	return { status, resolves, didOpens };
}

test("a second file in a resolved directory attaches without resolving again", async () => {
	expect(
		await attachSecondFile(
			{ serverId: "kotlin", languageId: "kotlin" },
			"/workspace/a.kt",
			"/workspace/b.kt",
		),
	).toEqual({ status: "running", resolves: 1, didOpens: 2 });
});

test("a worktree-rooted server attaches files from any directory without resolving again", async () => {
	expect(
		await attachSecondFile(
			{ serverId: "typescript", languageId: "typescript" },
			"/workspace/a.ts",
			"/workspace/src/nested/b.ts",
		),
	).toEqual({ status: "running", resolves: 1, didOpens: 2 });
});

test("a manifest-rooted server resolves a file in a new directory", async () => {
	const result = await attachSecondFile(
		{ serverId: "kotlin", languageId: "kotlin" },
		"/workspace/a.kt",
		"/workspace/other/b.kt",
	);
	expect(result.resolves).toBe(2);
});

test("a hidden tab's file is open on the server and its diagnostics paint on attach", async () => {
	const workspaceId = crypto.randomUUID();
	const path = "/workspace/hidden.kt";
	const document = acquireDocument(workspaceId, path, {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "val a = 1",
					revision: "1",
					byteLength: 9,
				}),
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2]);
	await Promise.resolve();
	const connection = {
		hostUrl: "http://localhost:1234",
		getWsToken: () => "test",
		trpcClient: {
			settings: {
				lsp: { get: { query: async () => lspSettingsSchema.parse({}) } },
			},
			lsp: {
				resolve: {
					mutate: async () => ({
						sessionId: "session",
						serverId: "kotlin",
						languageId: "kotlin",
						rootUri: "file:///workspace",
						state: "starting",
					}),
				},
				release: { mutate: async () => {} },
			},
		},
	} as unknown as ConstructorParameters<typeof LspCoordinator>[1];
	const coordinator = new LspCoordinator(
		workspaceId,
		connection,
		() => {},
		lspUriToFilePath,
	);
	coordinators.push(coordinator);
	coordinator.setBackgroundFiles([path]);
	await waitFor(
		() =>
			sockets[0]?.messages.some(
				(message) => message.method === "textDocument/diagnostic",
			) ?? false,
	);
	await new Promise((resolve) => setTimeout(resolve, 20));
	const compartment = new Compartment();
	const view = new EditorView({
		doc: "val a = 1",
		extensions: compartment.of([]),
	});
	views.push(view);
	const detach = coordinator.attach(document, view, compartment);
	expect(diagnosticCount(view.state)).toBe(1);
	await Promise.resolve();
	await Promise.resolve();
	expect(
		sockets[0].messages.filter(
			(message) => message.method === "textDocument/didOpen",
		),
	).toHaveLength(1);
	detach();
	view.dispatch({ effects: compartment.reconfigure([]) });
	await Promise.resolve();
	expect(
		sockets[0].messages.filter(
			(message) => message.method === "textDocument/didClose",
		),
	).toHaveLength(0);
	coordinator.setBackgroundFiles([]);
	await Promise.resolve();
	await Promise.resolve();
	expect(
		sockets[0].messages.filter(
			(message) => message.method === "textDocument/didClose",
		),
	).toHaveLength(1);
	releaseDocument(workspaceId, path);
});

test("a prefetched file is open on the server before its editor and adds no tree counts until opened", async () => {
	const workspaceId = crypto.randomUUID();
	const path = "/workspace/next.kt";
	prefetchDocument(workspaceId, path, {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "val a = 1",
					revision: "1",
					byteLength: 9,
				}),
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2]);
	const connection = statusConnection("starting");
	Reflect.set(connection.trpcClient.lsp.resolve, "mutate", async () => ({
		sessionId: "session",
		serverId: "kotlin",
		languageId: "kotlin",
		rootUri: "file:///workspace",
		state: "starting",
	}));
	const coordinator = new LspCoordinator(
		workspaceId,
		connection,
		() => {},
		lspUriToFilePath,
	);
	coordinators.push(coordinator);
	await coordinator.prefetch(path);
	await waitFor(
		() =>
			sockets[0]?.messages.some(
				(message) => message.method === "textDocument/diagnostic",
			) ?? false,
	);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(coordinator.getDiagnostics().size).toBe(0);
	const document = acquireDocument(
		workspaceId,
		path,
		{} as Parameters<typeof acquireDocument>[2],
	);
	const compartment = new Compartment();
	const view = new EditorView({
		doc: "val a = 1",
		extensions: compartment.of([]),
	});
	views.push(view);
	coordinator.attach(document, view, compartment);
	expect(diagnosticCount(view.state)).toBe(1);
	expect(coordinator.getDiagnostics().size).toBe(1);
	await Promise.resolve();
	await Promise.resolve();
	expect(
		sockets[0].messages.filter(
			(message) => message.method === "textDocument/didOpen",
		),
	).toHaveLength(1);
	releaseDocument(workspaceId, path);
});
