import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { editorCompartments } from "../editorSetup";

const SAVED_LIMIT = 20;

interface SavedEditor {
	state: EditorState;
	scroll: ReturnType<EditorView["scrollSnapshot"]>;
}

const saved = new Map<string, SavedEditor>();

export function saveEditorState(
	documentId: string,
	view: EditorView,
	scroll: SavedEditor["scroll"],
): void {
	saved.delete(documentId);
	saved.set(documentId, {
		state: view.state.update({
			effects: editorCompartments.lsp.reconfigure([]),
		}).state,
		scroll,
	});
	if (saved.size <= SAVED_LIMIT) return;
	const oldest = saved.keys().next().value;
	if (oldest !== undefined) saved.delete(oldest);
}

export function takeEditorState(documentId: string): SavedEditor | undefined {
	const entry = saved.get(documentId);
	saved.delete(documentId);
	return entry;
}
