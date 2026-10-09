import { afterAll, afterEach, expect, test } from "bun:test";
import { LSPClient, type Transport } from "@codemirror/lsp-client";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { filePathToLspUri } from "@superset/shared/lsp";
import { acquireDocument, releaseDocument } from "../fileDocumentStore";
import { documentChanges, LspWorkspace } from "./LspWorkspace";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});
const views: EditorView[] = [];
afterEach(() => {
	for (const view of views.splice(0)) view.destroy();
});

test("two splits share one versioned LSP document and unsaved content", async () => {
	const initial = `const fish = '🐟';\n${"const value = 1;\n".repeat(100)}`;
	const path = "/workspace/splits.ts";
	const workspaceId = crypto.randomUUID();
	const document = acquireDocument(workspaceId, path, {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: initial,
					revision: "1",
					byteLength: initial.length,
				}),
			},
			writeFile: { mutate: async () => ({ ok: true, revision: "2" }) },
		},
	} as unknown as Parameters<typeof acquireDocument>[2]);
	await Promise.resolve();
	const messages: {
		method: string;
		params?: {
			textDocument?: { version?: number };
			contentChanges?: unknown[];
		};
	}[] = [];
	const handlers = new Set<(message: string) => void>();
	const transport: Transport = {
		subscribe(handler) {
			handlers.add(handler);
		},
		unsubscribe(handler) {
			handlers.delete(handler);
		},
		send(message) {
			const parsed = JSON.parse(message);
			messages.push(parsed);
			if (parsed.method === "initialize")
				queueMicrotask(() => {
					for (const handler of handlers)
						handler(
							JSON.stringify({
								jsonrpc: "2.0",
								id: parsed.id,
								result: {
									capabilities: {
										textDocumentSync: {
											openClose: true,
											change: 2,
											save: { includeText: true },
										},
									},
								},
							}),
						);
				});
		},
	};
	const client = new LSPClient({
		workspace: (instance) => new LspWorkspace(instance, async () => null),
	}).connect(transport);
	await client.initializing;
	const workspace = client.workspace;
	if (!(workspace instanceof LspWorkspace))
		throw new Error("Expected shared workspace");
	workspace.register(document);
	const uri = filePathToLspUri(path);
	for (let index = 0; index < 2; index++)
		views.push(
			new EditorView({
				doc: initial,
				extensions: [
					client.plugin(uri, "typescript"),
					EditorView.updateListener.of((update) => {
						if (update.docChanged)
							document.setContent(update.state.doc.toString());
					}),
				],
			}),
		);
	await Promise.resolve();
	expect(
		messages.filter((message) => message.method === "textDocument/didOpen"),
	).toHaveLength(1);
	views[0].dispatch({ changes: { from: 0, to: 5, insert: "let" } });
	client.sync();
	await Promise.resolve();
	expect(views[1].state.doc.toString()).toBe(views[0].state.doc.toString());
	expect(document.dirty).toBe(true);
	expect(
		messages.filter((message) => message.method === "textDocument/didChange"),
	).toHaveLength(1);
	expect(workspace.files[0].version).toBe(2);
	await document.save();
	await Promise.resolve();
	expect(
		messages.filter((message) => message.method === "textDocument/didSave"),
	).toHaveLength(1);
	views.shift()?.destroy();
	await Promise.resolve();
	expect(
		messages.filter((message) => message.method === "textDocument/didClose"),
	).toHaveLength(0);
	views.shift()?.destroy();
	await Promise.resolve();
	expect(
		messages.filter((message) => message.method === "textDocument/didClose"),
	).toHaveLength(1);
	workspace.dispose();
	client.disconnect();
	releaseDocument(workspaceId, path);
});

test("minimal document changes preserve UTF-16 offsets and reload replacement", () => {
	const previous = Text.of(["🐟 ação", "second line"]);
	const next = "🐟 alteração\nsecond line";
	expect(documentChanges(previous, next).apply(previous).toString()).toBe(next);
	expect(documentChanges(previous, "reloaded").apply(previous).toString()).toBe(
		"reloaded",
	);
});

async function connectedWorkspace() {
	const messages: { method?: string }[] = [];
	const handlers = new Set<(message: string) => void>();
	const transport: Transport = {
		subscribe(handler) {
			handlers.add(handler);
		},
		unsubscribe(handler) {
			handlers.delete(handler);
		},
		send(message) {
			const parsed = JSON.parse(message);
			messages.push(parsed);
			if (parsed.method === "initialize")
				queueMicrotask(() => {
					for (const handler of handlers)
						handler(
							JSON.stringify({
								jsonrpc: "2.0",
								id: parsed.id,
								result: {
									capabilities: {
										textDocumentSync: { openClose: true, change: 2 },
									},
								},
							}),
						);
				});
		},
	};
	const client = new LSPClient({
		workspace: (instance) => new LspWorkspace(instance, async () => null),
	}).connect(transport);
	await client.initializing;
	const workspace = client.workspace;
	if (!(workspace instanceof LspWorkspace))
		throw new Error("Expected shared workspace");
	const count = (method: string) =>
		messages.filter((message) => message.method === method).length;
	return { client, workspace, count };
}

test("a file kept for a hidden tab stays open on the server", async () => {
	const path = "/workspace/kept.ts";
	const workspaceId = crypto.randomUUID();
	const document = acquireDocument(workspaceId, path, {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "const kept = 1;\n",
					revision: "1",
					byteLength: 16,
				}),
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2]);
	await Promise.resolve();
	const { client, workspace, count } = await connectedWorkspace();
	const uri = filePathToLspUri(path);
	expect(workspace.openWithoutView(document, "typescript")).toBe(true);
	await Promise.resolve();
	expect(count("textDocument/didOpen")).toBe(1);
	const view = new EditorView({
		doc: "const kept = 1;\n",
		extensions: client.plugin(uri, "typescript"),
	});
	view.destroy();
	await Promise.resolve();
	expect(count("textDocument/didOpen")).toBe(1);
	expect(count("textDocument/didClose")).toBe(0);
	workspace.release(uri);
	await Promise.resolve();
	expect(count("textDocument/didClose")).toBe(1);
	workspace.dispose();
	client.disconnect();
	releaseDocument(workspaceId, path);
});
