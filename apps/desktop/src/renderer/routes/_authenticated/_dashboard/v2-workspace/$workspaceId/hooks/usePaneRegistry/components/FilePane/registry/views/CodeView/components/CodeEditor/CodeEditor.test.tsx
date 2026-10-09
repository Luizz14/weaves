import { afterEach, expect, test } from "bun:test";
import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_EDITOR_SETTINGS } from "@superset/shared/editor-settings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SharedFileDocument } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, cleanup } = await import("@testing-library/react");
const { EDITOR_SETTINGS_QUERY_KEY } = await import(
	"renderer/hooks/useEditorSettings"
);
const { FONT_SETTINGS_QUERY_KEY } = await import("renderer/lib/font-settings");
const { loadLanguageSupport } = await import(
	"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/utils/loadLanguageSupport"
);
const { CodeEditor } = await import("./CodeEditor");

afterEach(cleanup);

function withQueries(children: ReactNode) {
	const client = new QueryClient();
	client.setQueryData(EDITOR_SETTINGS_QUERY_KEY, DEFAULT_EDITOR_SETTINGS);
	client.setQueryData(FONT_SETTINGS_QUERY_KEY, {});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const source = "export const answer: number = 42;\n// done\n";

test("a file with a language server paints with its lint gutter", () => {
	const view = render(
		withQueries(<CodeEditor value={source} language="typescript" lintGutter />),
	);
	expect(view.container.querySelector(".cm-gutter-lint")).not.toBeNull();
});

test("a loaded language colors the first frame", async () => {
	await loadLanguageSupport("typescript");
	const view = render(
		withQueries(<CodeEditor value={source} language="typescript" />),
	);
	const highlighted = [
		...view.container.querySelectorAll(".cm-line span"),
	].filter((span) => [...span.classList].some((name) => name.startsWith("ͼ")));
	expect(highlighted.length).toBeGreaterThan(0);
	expect(view.container.querySelector(".cm-gutter-lint")).toBeNull();
});

function editorView(container: HTMLElement): EditorView {
	const view = EditorView.findFromDOM(
		container.querySelector(".cm-editor") as HTMLElement,
	);
	if (!view) throw new Error("editor not mounted");
	return view;
}

test("reopening a document restores its editor state in the first frame", () => {
	const document = {
		id: crypto.randomUUID(),
		absolutePath: "/workspace/answer.ts",
	} as SharedFileDocument;
	const editor = () => (
		<CodeEditor document={document} value={source} language="typescript" />
	);
	const first = render(withQueries(editor()));
	const view = editorView(first.container);
	view.dispatch(
		setDiagnostics(view.state, [
			{ from: 13, to: 19, severity: "error", message: "Unused" },
		]),
	);
	view.dispatch({ selection: { anchor: 20 } });
	first.unmount();

	const second = render(withQueries(editor()));
	const restored = editorView(second.container);
	expect(diagnosticCount(restored.state)).toBe(1);
	expect(restored.state.selection.main.head).toBe(20);
	expect(second.container.querySelector(".cm-lintRange")).not.toBeNull();
});
