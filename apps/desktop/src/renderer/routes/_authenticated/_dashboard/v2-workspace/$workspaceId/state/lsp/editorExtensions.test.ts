import { afterAll, afterEach, expect, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { editorSettingsSchema } from "@superset/shared/editor-settings";
import { editorPreferenceExtensions } from "./editorExtensions";
import { applyFormatEdits } from "./formatEdits";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const views: EditorView[] = [];
afterEach(() => {
	for (const view of views.splice(0)) view.destroy();
});
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

test("relative gutter tracks the cursor without modifying document content", () => {
	const editing = editorSettingsSchema.parse({
		editing: {
			lineNumbers: "relative",
			whitespace: "selection",
			indentGuides: true,
		},
	}).editing;
	const view = new EditorView({
		doc: "one\ntwo\nthree\nfour",
		extensions: editorPreferenceExtensions(editing),
	});
	views.push(view);
	const text = () =>
		[...view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
			.slice(1)
			.map((element) => element.textContent);
	expect(text()).toEqual(["1", "1", "2", "3"]);
	view.dispatch({ selection: { anchor: 8 } });
	expect(text()).toEqual(["2", "1", "3", "1"]);
	expect(view.state.doc.toString()).toBe("one\ntwo\nthree\nfour");
});

test("equal editing preferences reuse the same extensions", () => {
	const editing = editorSettingsSchema.parse({}).editing;
	expect(editorPreferenceExtensions({ ...editing })).toBe(
		editorPreferenceExtensions(editing),
	);
	expect(
		editorPreferenceExtensions({ ...editing, tabSize: editing.tabSize + 2 }),
	).not.toBe(editorPreferenceExtensions(editing));
});

test("format edits use UTF-16 positions and reject out-of-bounds edits", () => {
	const content = "🐟 value\nnext";
	expect(
		applyFormatEdits(content, [
			{
				range: {
					start: { line: 0, character: 3 },
					end: { line: 0, character: 8 },
				},
				newText: "formatted",
			},
		]),
	).toBe("🐟 formatted\nnext");
	expect(() =>
		applyFormatEdits(content, [
			{
				range: {
					start: { line: 9, character: 0 },
					end: { line: 9, character: 1 },
				},
				newText: "bad",
			},
		]),
	).toThrow("Invalid formatter line");
});
