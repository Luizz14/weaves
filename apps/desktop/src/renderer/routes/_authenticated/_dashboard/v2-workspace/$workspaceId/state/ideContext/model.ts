import type { EditorView } from "@codemirror/view";
import type { WorkspaceState } from "@superset/panes";
import {
	IDE_CONTEXT_MAX_PATHS,
	IDE_CONTEXT_MAX_PAYLOAD_BYTES,
	IDE_CONTEXT_MAX_SELECTION_BYTES,
	type IdeContextSnapshot,
	ideContextByteLength,
	truncateIdeContextText,
} from "@superset/shared/ide-context";
import type { FilePaneData, PaneViewerData } from "../../types";
import type { SharedFileDocument } from "../fileDocumentStore";

type ActiveFile = NonNullable<IdeContextSnapshot["activeFile"]>;

export class IdeContextModel {
	private lastEditor: {
		document: SharedFileDocument;
		file: ActiveFile;
		paneId: string;
	} | null = null;
	private readonly editors = new Map<
		string,
		{ document: SharedFileDocument; view: EditorView; file: ActiveFile }
	>();
	private lastView: EditorView | null = null;
	private readonly listeners = new Set<() => void>();

	constructor(
		readonly scope: {
			workspaceId: string;
			organizationId: string;
			hostUrl: string;
		},
		private readonly layout: () => WorkspaceState<PaneViewerData>,
		private readonly getDocument: (path: string) => SharedFileDocument | null,
	) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	notify(): void {
		for (const listener of this.listeners) listener();
	}

	attachEditor(
		document: SharedFileDocument,
		view: EditorView,
		paneId: string,
	): () => void {
		if (document.workspaceId !== this.scope.workspaceId) return () => {};
		this.editors.set(paneId, {
			document,
			view,
			file: this.editorFile(document, view),
		});
		const focus = () => this.capture(document, view, paneId, true);
		view.dom.addEventListener("focusin", focus);
		if (view.hasFocus) focus();
		return () => {
			view.dom.removeEventListener("focusin", focus);
			if (this.editors.get(paneId)?.view === view) this.editors.delete(paneId);
			if (this.lastView === view) this.lastView = null;
		};
	}

	capture(
		document: SharedFileDocument,
		view: EditorView,
		paneId: string,
		focused = false,
	): void {
		if (
			document.workspaceId !== this.scope.workspaceId ||
			document.isBinary ||
			document.orphaned
		)
			return;
		const layout = this.layout();
		const activeTab = layout.tabs.find((tab) => tab.id === layout.activeTabId);
		if (
			!focused &&
			this.lastView !== view &&
			!view.hasFocus &&
			activeTab?.activePaneId !== paneId
		)
			return;
		if (
			document.content.kind !== "text" ||
			document.content.value !== view.state.doc.toString()
		)
			return;
		const file = this.editorFile(document, view);
		const editor = this.editors.get(paneId);
		if (editor?.view === view) editor.file = file;
		this.lastView = view;
		this.lastEditor = { document, file, paneId };
		this.notify();
	}

	private editorFile(
		document: SharedFileDocument,
		view: EditorView,
	): ActiveFile {
		const range = view.state.selection.main;
		const matches =
			document.content.kind === "text" &&
			document.content.value === view.state.doc.toString();
		const selected =
			matches && document.content.kind === "text"
				? document.content.value.slice(range.from, range.to)
				: "";
		const text = truncateIdeContextText(
			selected,
			IDE_CONTEXT_MAX_SELECTION_BYTES,
		);
		return {
			path: document.absolutePath,
			documentId: document.id,
			version: document.getVersion(),
			selection:
				!matches || range.empty
					? null
					: {
							from: range.from,
							to: range.to,
							startLine: view.state.doc.lineAt(range.from).number,
							endLine: view.state.doc.lineAt(range.to).number,
							text,
							truncated: text !== selected,
						},
		};
	}

	snapshot(
		producerId: string,
		sequence: number,
		activated = false,
	): IdeContextSnapshot {
		const layout = this.layout();
		const allPaths = [
			...new Set(
				layout.tabs.flatMap((tab) =>
					Object.values(tab.panes)
						.filter((pane) => pane.kind === "file")
						.map((pane) => (pane.data as FilePaneData).filePath),
				),
			),
		];
		let activeFile: ActiveFile | null = null;
		const activeTab = layout.tabs.find((tab) => tab.id === layout.activeTabId);
		const activePane = activeTab?.activePaneId
			? activeTab.panes[activeTab.activePaneId]
			: undefined;
		if (activePane?.kind === "file") {
			const path = (activePane.data as FilePaneData).filePath;
			const editor = this.editors.get(activePane.id);
			const document = editor?.document ?? this.getDocument(path);
			const last = this.lastEditor;
			const captured =
				editor?.file ?? (last?.paneId === activePane.id ? last.file : null);
			if (
				document &&
				document.workspaceId === this.scope.workspaceId &&
				document.absolutePath === path &&
				!document.isBinary &&
				!document.orphaned &&
				document.content.kind === "text"
			) {
				activeFile = {
					path,
					documentId: document.id,
					version: document.getVersion(),
					selection:
						captured?.path === path &&
						captured.documentId === document.id &&
						captured.version === document.getVersion()
							? captured.selection
							: null,
				};
				this.lastEditor = { document, file: activeFile, paneId: activePane.id };
				this.lastView = editor?.view ?? null;
			} else {
				this.lastEditor = null;
				this.lastView = null;
			}
		} else {
			const last = this.lastEditor;
			const stillOpen =
				last &&
				layout.tabs.some((tab) =>
					Object.values(tab.panes).some(
						(pane) =>
							pane.kind === "file" &&
							pane.id === last.paneId &&
							(pane.data as FilePaneData).filePath === last.file.path,
					),
				);
			if (
				last &&
				stillOpen &&
				last.document.absolutePath === last.file.path &&
				!last.document.orphaned &&
				!last.document.isBinary &&
				last.document.content.kind === "text"
			) {
				activeFile = {
					...last.file,
					version: last.document.getVersion(),
					selection:
						last.document.getVersion() === last.file.version
							? last.file.selection
							: null,
				};
			} else {
				this.lastEditor = null;
				this.lastView = null;
			}
		}
		const orderedPaths = activeFile
			? [
					activeFile.path,
					...allPaths.filter((path) => path !== activeFile.path),
				]
			: allPaths;
		const openFiles = orderedPaths
			.filter(
				(path) =>
					path.length > 0 &&
					ideContextByteLength(path) <= 4096 &&
					!path.includes("\0"),
			)
			.slice(0, IDE_CONTEXT_MAX_PATHS);
		const snapshot: IdeContextSnapshot = {
			workspaceId: this.scope.workspaceId,
			producerId,
			sequence,
			activated,
			openFiles,
			omittedFiles: allPaths.length - openFiles.length,
			activeFile:
				activeFile && openFiles.includes(activeFile.path)
					? {
							...activeFile,
							selection: activeFile.selection
								? { ...activeFile.selection }
								: null,
						}
					: null,
		};
		while (
			ideContextByteLength(JSON.stringify(snapshot)) >
				IDE_CONTEXT_MAX_PAYLOAD_BYTES &&
			snapshot.openFiles.length > 1
		) {
			snapshot.openFiles.pop();
			snapshot.omittedFiles++;
		}
		while (
			ideContextByteLength(JSON.stringify(snapshot)) >
				IDE_CONTEXT_MAX_PAYLOAD_BYTES &&
			snapshot.activeFile?.selection?.text
		) {
			const selection = snapshot.activeFile.selection;
			selection.text = truncateIdeContextText(
				selection.text,
				Math.max(0, ideContextByteLength(selection.text) - 256),
			);
			selection.truncated = true;
		}
		if (
			ideContextByteLength(JSON.stringify(snapshot)) >
			IDE_CONTEXT_MAX_PAYLOAD_BYTES
		)
			snapshot.activeFile = null;

		return snapshot;
	}
}
