import {
	type Diagnostic,
	forEachDiagnostic,
	setDiagnostics,
} from "@codemirror/lint";
import {
	type LSPClient,
	LSPPlugin,
	Workspace,
	type WorkspaceFile,
} from "@codemirror/lsp-client";
import { ChangeSet, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { filePathToLspUri } from "@superset/shared/lsp";
import type { SharedFileDocument } from "../fileDocumentStore";

type OpenFile = WorkspaceFile & {
	document: SharedFileDocument;
	views: Set<EditorView>;
	unsubscribe: () => void;
	unsubscribeSaved: () => void;
};

export function documentChanges(previous: Text, next: string): ChangeSet {
	const before = previous.toString();
	let start = 0;
	while (
		start < before.length &&
		start < next.length &&
		before[start] === next[start]
	)
		start++;
	let end = before.length;
	let nextEnd = next.length;
	while (
		end > start &&
		nextEnd > start &&
		before[end - 1] === next[nextEnd - 1]
	) {
		end--;
		nextEnd--;
	}
	return ChangeSet.of(
		{ from: start, to: end, insert: next.slice(start, nextEnd) },
		previous.length,
	);
}

export class LspWorkspace extends Workspace {
	files: OpenFile[] = [];
	private documents = new Map<string, SharedFileDocument>();
	private retained = new Set<string>();
	private version = 0;
	private syncTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		client: LSPClient,
		private navigate: (uri: string) => Promise<EditorView | null>,
		private onSync: () => void = () => {},
		private onClose: (uri: string) => void = () => {},
	) {
		super(client);
	}

	register(document: SharedFileDocument) {
		this.documents.set(filePathToLspUri(document.absolutePath), document);
	}

	openFile(uri: string, languageId: string, view: EditorView) {
		const document = this.documents.get(uri);
		const stale = this.files.find((file) => file.uri === uri);
		if (stale && document && stale.document.id !== document.id)
			this.close(stale);
		const existing = this.files.find((file) => file.uri === uri);
		if (existing) {
			existing.views.add(view);
			queueMicrotask(() => {
				if (!existing.views.has(view)) return;
				if (!existing.doc.eq(view.state.doc)) this.client.sync();
				const source = [...existing.views].find(
					(candidate) => candidate !== view,
				);
				if (!source) return;
				const diagnostics: Diagnostic[] = [];
				forEachDiagnostic(source.state, (diagnostic, from, to) =>
					diagnostics.push({ ...diagnostic, from, to }),
				);
				view.dispatch(setDiagnostics(view.state, diagnostics));
			});
			return;
		}
		if (!document) throw new Error("LSP document was not registered");
		const file = this.track(uri, languageId, document, view.state.doc, [view]);
		this.client.didOpen(file);
		this.scheduleSync();
	}

	/** Opens a document on the server without an editor, like a hidden tab. */
	openWithoutView(document: SharedFileDocument, languageId: string): boolean {
		if (document.content.kind !== "text") return false;
		const uri = filePathToLspUri(document.absolutePath);
		this.register(document);
		this.retained.add(uri);
		const existing = this.files.find((file) => file.uri === uri);
		if (existing?.document.id === document.id) return true;
		if (existing) this.close(existing);
		const file = this.track(
			uri,
			languageId,
			document,
			Text.of(document.content.value.split(/\r\n?|\n/)),
			[],
		);
		this.client.didOpen(file);
		this.scheduleSync();
		return true;
	}

	retain(uri: string) {
		this.retained.add(uri);
	}

	release(uri: string) {
		this.retained.delete(uri);
		const file = this.files.find((entry) => entry.uri === uri);
		if (file && !file.views.size) this.close(file);
	}

	hasRetainedFiles() {
		return this.retained.size > 0;
	}

	private track(
		uri: string,
		languageId: string,
		document: SharedFileDocument,
		doc: Text,
		views: EditorView[],
	): OpenFile {
		const file: OpenFile = {
			uri,
			languageId,
			version: this.nextVersion(),
			doc,
			document,
			views: new Set(views),
			getView(main) {
				return main && this.views.has(main)
					? main
					: (this.views.values().next().value ?? null);
			},
			unsubscribe: () => {},
			unsubscribeSaved: () => {},
		};
		file.unsubscribe = document.subscribe(() => {
			if (document.content.kind !== "text") return;
			const value = document.content.value;
			for (const editor of file.views) {
				if (editor.state.doc.toString() !== value)
					editor.dispatch({
						changes: documentChanges(editor.state.doc, value),
					});
			}
			this.scheduleSync();
		});
		file.unsubscribeSaved = document.subscribeSaved((content) => {
			this.client.sync();
			const sync = this.client.serverCapabilities?.textDocumentSync;
			if (typeof sync !== "object" || !sync.save) return;
			this.client.notification("textDocument/didSave", {
				textDocument: { uri },
				...(typeof sync.save === "object" && sync.save.includeText
					? { text: content }
					: {}),
			});
		});
		this.files.push(file);
		return file;
	}

	private nextVersion() {
		return ++this.version;
	}

	private scheduleSync() {
		if (this.syncTimer) clearTimeout(this.syncTimer);
		this.syncTimer = setTimeout(() => {
			this.syncTimer = null;
			this.client.sync();
		}, 150);
	}

	syncFiles() {
		const updates = [];
		for (const file of this.files) {
			if (file.document.content.kind !== "text") continue;
			const value = file.document.content.value;
			if (file.doc.toString() !== value) {
				const prevDoc = file.doc;
				const changes = documentChanges(prevDoc, value);
				file.doc = changes.apply(prevDoc);
				file.version = this.nextVersion();
				updates.push({ file, prevDoc, changes });
			}
			for (const view of file.views) LSPPlugin.get(view)?.clear();
		}
		queueMicrotask(this.onSync);
		return updates;
	}

	closeFile(uri: string, view: EditorView) {
		const file = this.files.find((entry) => entry.uri === uri);
		if (!file) return;
		file.views.delete(view);
		if (file.views.size || this.retained.has(uri)) return;
		this.close(file);
	}

	private close(file: OpenFile) {
		file.unsubscribe();
		file.unsubscribeSaved();
		this.files = this.files.filter((entry) => entry !== file);
		if (this.documents.get(file.uri) === file.document)
			this.documents.delete(file.uri);
		this.client.didClose(file.uri);
		this.onClose(file.uri);
	}

	displayFile(uri: string) {
		return this.navigate(uri);
	}

	dispose() {
		if (this.syncTimer) clearTimeout(this.syncTimer);
		for (const file of this.files) {
			file.unsubscribe();
			file.unsubscribeSaved();
		}
		this.files = [];
		this.documents.clear();
		this.retained.clear();
	}
}
