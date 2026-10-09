import { expect, test } from "bun:test";
import { undo, undoDepth } from "@codemirror/commands";
import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import {
	type ConfiguredCompartments,
	createEditorState,
	editorCompartments,
	restoreEditorState,
} from "./editorSetup";

const configured: ConfiguredCompartments = {
	preferences: [],
	lintGutter: [],
	editable: [],
	theme: [],
	language: [],
};

function edited() {
	let state = createEditorState("const a = 1;\n", configured);
	state = state.update(
		setDiagnostics(state, [
			{ from: 6, to: 7, severity: "error", message: "unused" },
		]),
	).state;
	return state.update({
		changes: { from: 0, insert: "// note\n" },
		selection: { anchor: 3 },
	}).state;
}

test("a restored state keeps diagnostics, selection and undo", () => {
	const saved = edited();
	const restored = restoreEditorState(saved, saved.sliceDoc(), configured);
	expect(restored).toBe(saved);
	expect(diagnosticCount(restored)).toBe(1);
	expect(restored.selection.main.head).toBe(3);
	expect(undoDepth(restored)).toBe(1);
});

test("text changed on disk is applied outside the undo history", () => {
	const saved = edited();
	const restored = restoreEditorState(
		saved,
		`${saved.sliceDoc()}// disk\n`,
		configured,
	);
	expect(undoDepth(restored)).toBe(1);
	let undone = restored;
	undo({
		state: restored,
		dispatch: (tr) => {
			undone = tr.state;
		},
	});
	expect(undone.sliceDoc()).toBe("const a = 1;\n// disk\n");
	expect(diagnosticCount(restored)).toBe(1);
});

test("only compartments whose extension changed are reconfigured", () => {
	const saved = edited();
	const readOnly = [EditorState.readOnly.of(true)];
	const restored = restoreEditorState(saved, saved.sliceDoc(), {
		...configured,
		editable: readOnly,
	});
	expect(editorCompartments.editable.get(restored)).toBe(readOnly);
	expect(editorCompartments.theme.get(restored)).toBe(configured.theme);
	expect(restored.readOnly).toBe(true);
});
