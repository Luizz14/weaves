import { expect, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	createEditorState,
	restoreEditorState,
	setViewHandlers,
} from "./editorSetup";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

test("restored editors capture selection and buffer updates through the current view handlers", () => {
	const configured = {
		preferences: [],
		lintGutter: [],
		editable: [],
		theme: [],
		language: [],
	};
	const original = new EditorView({
		state: createEditorState("original", configured),
	});
	let originalCaptures = 0;
	setViewHandlers(original, {
		onChange: () => {},
		onSave: () => {},
		isExternalUpdate: () => false,
		onUpdate: () => originalCaptures++,
	});
	original.dispatch({ selection: { anchor: 2 } });
	expect(originalCaptures).toBe(1);
	const saved = original.state;
	original.destroy();

	const restored = new EditorView({
		state: restoreEditorState(saved, "original", configured),
	});
	const captured: Array<{ head: number; text: string }> = [];
	const changes: string[] = [];
	let external = false;
	setViewHandlers(restored, {
		onChange: (value) => changes.push(value),
		onSave: () => {},
		isExternalUpdate: () => external,
		onUpdate: (update) => {
			if (update.docChanged || update.selectionSet)
				captured.push({
					head: update.state.selection.main.head,
					text: update.state.doc.toString(),
				});
		},
	});
	try {
		restored.dispatch({ selection: { anchor: 4 } });
		restored.dispatch({ changes: { from: 0, to: 8, insert: "edited" } });
		external = true;
		restored.dispatch({ changes: { from: 0, to: 6, insert: "synced" } });
		expect(captured).toEqual([
			{ head: 4, text: "original" },
			{ head: 0, text: "edited" },
			{ head: 0, text: "synced" },
		]);
		expect(changes).toEqual(["edited"]);
		expect(originalCaptures).toBe(1);
	} finally {
		restored.destroy();
	}
});
