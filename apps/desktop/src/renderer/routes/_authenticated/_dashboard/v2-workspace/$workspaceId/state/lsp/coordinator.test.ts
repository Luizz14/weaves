import { afterAll, afterEach, expect, test } from "bun:test";
import { diagnosticCount } from "@codemirror/lint";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { filePathToLspUri, lspUriToFilePath } from "@superset/shared/lsp";
import { acquireDocument, releaseDocument } from "../fileDocumentStore";
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
			coordinator.attach(document, view, compartment, (status) =>
				statuses.push(status),
			),
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
		coordinator.attach(document, lateView, lateCompartment, (status) =>
			statuses.push(status),
		),
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
