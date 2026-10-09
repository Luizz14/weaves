import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import {
	bracketMatching,
	codeFolding,
	foldGutter,
	foldKeymap,
	indentOnInput,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
	Compartment,
	EditorState,
	type Extension,
	Transaction,
} from "@codemirror/state";
import {
	drawSelection,
	dropCursor,
	EditorView,
	highlightSpecialChars,
	keymap,
	type ViewUpdate,
} from "@codemirror/view";
import { colorPicker } from "@replit/codemirror-css-color-picker";
import { documentChanges } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/LspWorkspace";
import { contourSelectionLayer } from "../extensions/contourSelectionLayer";
import { buildFoldChevron } from "../extensions/foldChevron";
import { buildFoldPlaceholder } from "../extensions/foldPlaceholder";
import { selectionClassTogglePlugin } from "../extensions/selectionClassTogglePlugin";
import { viewportSyntax } from "../extensions/viewportSyntax";

export const editorCompartments = {
	preferences: new Compartment(),
	lintGutter: new Compartment(),
	editable: new Compartment(),
	theme: new Compartment(),
	language: new Compartment(),
	lsp: new Compartment(),
};

export type ConfiguredCompartments = Record<
	Exclude<keyof typeof editorCompartments, "lsp">,
	Extension
>;

interface ViewHandlers {
	onChange(value: string): void;
	onSave(): void;
	isExternalUpdate(): boolean;
	onUpdate?(update: ViewUpdate): void;
}

const viewHandlers = new WeakMap<EditorView, ViewHandlers>();

export function setViewHandlers(view: EditorView, handlers: ViewHandlers) {
	viewHandlers.set(view, handlers);
}

const gutterExtensions: Extension = [
	highlightSpecialChars(),
	history(),
	foldGutter({ markerDOM: buildFoldChevron }),
	codeFolding({ placeholderDOM: buildFoldPlaceholder }),
];

const selectionExtensions: Extension = [
	drawSelection(),
	dropCursor(),
	EditorState.allowMultipleSelections.of(true),
	indentOnInput(),
	bracketMatching(),
	highlightSelectionMatches(),
	colorPicker,
	contourSelectionLayer,
	selectionClassTogglePlugin,
];

const inputExtensions: Extension = [
	EditorView.contentAttributes.of({
		spellcheck: "false",
	}),
	keymap.of([
		indentWithTab,
		...defaultKeymap,
		...historyKeymap,
		...searchKeymap,
		...foldKeymap,
	]),
	keymap.of([
		{
			key: "Mod-s",
			run: (view) => {
				viewHandlers.get(view)?.onSave();
				return true;
			},
		},
	]),
];

const changeListener = EditorView.updateListener.of((update) => {
	const handlers = viewHandlers.get(update.view);
	if (!handlers) return;
	if (update.docChanged && !handlers.isExternalUpdate()) {
		handlers.onChange(update.state.doc.toString());
	}
	handlers.onUpdate?.(update);
});

export function createEditorState(
	doc: string,
	configured: ConfiguredCompartments,
): EditorState {
	return EditorState.create({
		doc,
		extensions: [
			editorCompartments.preferences.of(configured.preferences),
			gutterExtensions,
			editorCompartments.lintGutter.of(configured.lintGutter),
			selectionExtensions,
			editorCompartments.editable.of(configured.editable),
			inputExtensions,
			editorCompartments.theme.of(configured.theme),
			editorCompartments.language.of(configured.language),
			viewportSyntax,
			editorCompartments.lsp.of([]),
			changeListener,
		],
	});
}

export function restoreEditorState(
	saved: EditorState,
	doc: string,
	configured: ConfiguredCompartments,
): EditorState {
	let state = saved;
	if (state.sliceDoc() !== doc)
		state = state.update({
			changes: documentChanges(state.doc, doc),
			annotations: Transaction.addToHistory.of(false),
		}).state;
	const effects = (Object.keys(configured) as (keyof ConfiguredCompartments)[])
		.filter((name) => editorCompartments[name].get(state) !== configured[name])
		.map((name) => editorCompartments[name].reconfigure(configured[name]));
	return effects.length ? state.update({ effects }).state : state;
}
