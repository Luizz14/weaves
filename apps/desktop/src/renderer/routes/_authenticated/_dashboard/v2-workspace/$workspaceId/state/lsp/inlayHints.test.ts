import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { inlayHints } from "./inlayHints";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const views: EditorView[] = [];
afterEach(() => {
	for (const view of views.splice(0)) view.destroy();
});
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

test("inlay hints filter categories, leave the buffer intact, and reject responses after an edit", async () => {
	const responses: Array<(value: unknown) => void> = [];
	let cancelled = 0;
	const plugin = {
		uri: "file:///example.ts",
		client: {
			serverCapabilities: { inlayHintProvider: true },
			sync() {},
			cancelRequest() {
				cancelled++;
			},
			request: () => new Promise((resolve) => responses.push(resolve)),
		},
		toPosition: (character: number) => ({ line: 0, character }),
		fromPosition: (position: { character: number }) => position.character,
	} as unknown as ReturnType<typeof LSPPlugin.get>;
	const get = spyOn(LSPPlugin, "get").mockReturnValue(plugin);
	try {
		const view = new EditorView({
			doc: "value",
			extensions: inlayHints({
				enabled: true,
				types: true,
				parameters: false,
				other: false,
			}),
		});
		views.push(view);
		await new Promise((resolve) => setTimeout(resolve, 180));
		expect(responses.length).toBe(1);
		responses[0]?.([
			{ position: { line: 0, character: 5 }, label: ": number", kind: 1 },
			{ position: { line: 0, character: 0 }, label: "parameter:", kind: 2 },
		]);
		await Promise.resolve();
		await Promise.resolve();
		expect(view.dom.querySelector(".cm-editor-inlay-hint")?.textContent).toBe(
			": number",
		);
		expect(view.state.doc.toString()).toBe("value");
		view.dispatch({ changes: { from: 5, insert: "!" } });
		await new Promise((resolve) => setTimeout(resolve, 180));
		view.dispatch({ changes: { from: 6, insert: "!" } });
		responses[1]?.([
			{ position: { line: 0, character: 5 }, label: "stale", kind: 1 },
		]);
		await Promise.resolve();
		await Promise.resolve();
		expect(cancelled).toBeGreaterThan(0);
		expect(view.dom.querySelector(".cm-editor-inlay-hint")).toBeNull();
		expect(view.state.doc.toString()).toBe("value!!");
	} finally {
		for (const view of views.splice(0)) view.destroy();
		get.mockRestore();
	}
});
