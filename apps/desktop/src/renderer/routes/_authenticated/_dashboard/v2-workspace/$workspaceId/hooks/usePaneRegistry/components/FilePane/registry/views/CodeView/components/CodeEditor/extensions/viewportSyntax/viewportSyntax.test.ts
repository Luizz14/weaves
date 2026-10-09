import { afterAll, afterEach, expect, test } from "bun:test";
import { javascript } from "@codemirror/lang-javascript";
import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { viewportSyntax } from "./viewportSyntax";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const views: EditorView[] = [];
afterEach(() => {
	for (const view of views.splice(0)) view.destroy();
});
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

const longLine = `const value = ${JSON.stringify("x".repeat(180))};`;
const doc = Array.from({ length: 400 }, () => longLine).join("\n");

function editor(extensions: Extension[]) {
	const view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [javascript({ typescript: true }), ...extensions],
		}),
		parent: document.body,
	});
	views.push(view);
	return view;
}

test("the visible range is parsed before the frame paints", async () => {
	const view = editor([viewportSyntax]);
	expect(view.viewport.to).toBeGreaterThan(3000);
	await Promise.resolve();
	expect(syntaxTreeAvailable(view.state, view.viewport.to)).toBe(true);
});

test("without the plugin the initial parse stops short of the viewport", async () => {
	const view = editor([]);
	await Promise.resolve();
	expect(syntaxTreeAvailable(view.state, view.viewport.to)).toBe(false);
});
