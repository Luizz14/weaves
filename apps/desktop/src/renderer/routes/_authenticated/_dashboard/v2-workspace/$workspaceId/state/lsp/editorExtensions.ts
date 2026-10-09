import { indentUnit } from "@codemirror/language";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	GutterMarker,
	gutter,
	highlightActiveLine,
	highlightActiveLineGutter,
	lineNumbers,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import type { EditorSettings } from "@superset/shared/editor-settings";
import { memoizeByKey } from "../../utils/memoizeByKey";

class RelativeNumber extends GutterMarker {
	constructor(
		private number: number,
		private active: boolean,
	) {
		super();
		this.elementClass = active ? "cm-activeLineGutter" : "";
	}
	eq(other: RelativeNumber) {
		return this.number === other.number && this.active === other.active;
	}

	toDOM() {
		return document.createTextNode(String(this.number));
	}
}

function relativeNumbers() {
	return gutter({
		class: "cm-lineNumbers",
		lineMarker: (view, line) => {
			const number = view.state.doc.lineAt(line.from).number;
			const current = view.state.doc.lineAt(
				view.state.selection.main.head,
			).number;
			return new RelativeNumber(
				number === current ? number : Math.abs(number - current),
				number === current,
			);
		},
		lineMarkerChange: (update) => update.selectionSet,
		initialSpacer: (view) => new RelativeNumber(view.state.doc.lines, false),
	});
}

const extensionsByPreferences = memoizeByKey<Extension>(16);

export function editorPreferenceExtensions(
	editing: EditorSettings["editing"],
): Extension {
	return extensionsByPreferences(JSON.stringify(editing), () =>
		buildPreferenceExtensions(editing),
	);
}

function buildPreferenceExtensions(editing: EditorSettings["editing"]) {
	const markers = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet)
					this.decorations = this.build(update.view);
			}
			build(view: EditorView) {
				if (editing.whitespace === "none" && !editing.indentGuides)
					return Decoration.none;
				const ranges: Range<Decoration>[] = [];
				for (const range of view.visibleRanges) {
					const first = view.state.doc.lineAt(range.from).number;
					const last = view.state.doc.lineAt(range.to).number;
					for (let number = first; number <= last; number++) {
						const line = view.state.doc.line(number);
						const leading = /^[\t ]*/.exec(line.text)?.[0].length ?? 0;
						for (let index = 0; index < line.length; index++) {
							const char = line.text[index];
							if (char !== " " && char !== "\t") continue;
							const position = line.from + index;
							const selected = view.state.selection.ranges.some(
								(selection) =>
									position >= selection.from && position < selection.to,
							);
							if (
								editing.whitespace === "all" ||
								(editing.whitespace === "selection" && selected)
							)
								ranges.push(
									Decoration.mark({
										class:
											char === "\t"
												? "cm-preference-tab"
												: "cm-preference-space",
									}).range(position, position + 1),
								);
							if (
								editing.indentGuides &&
								index < leading &&
								(char === "\t" || index % editing.tabSize === 0)
							)
								ranges.push(
									Decoration.mark({ class: "cm-preference-indent" }).range(
										position,
										position + 1,
									),
								);
						}
					}
				}
				return Decoration.set(ranges, true);
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
	return [
		EditorState.tabSize.of(editing.tabSize),
		indentUnit.of(editing.hardTabs ? "\t" : " ".repeat(editing.tabSize)),
		editing.softWrap === "none" ? [] : EditorView.lineWrapping,
		editing.lineNumbers === "off"
			? []
			: editing.lineNumbers === "relative"
				? relativeNumbers()
				: lineNumbers(),
		editing.highlightActiveLine
			? [highlightActiveLine(), highlightActiveLineGutter()]
			: [],
		EditorView.theme({
			".cm-content": {
				maxWidth:
					editing.softWrap === "bounded"
						? `${editing.preferredLineLength}ch`
						: "none",
			},
			".cm-cursor": { animation: editing.cursorBlink ? "" : "none" },
			".cm-preference-space, .cm-preference-tab": { position: "relative" },
			".cm-preference-space::before": {
				content: '"·"',
				position: "absolute",
				opacity: "0.4",
				pointerEvents: "none",
			},
			".cm-preference-tab::before": {
				content: '"→"',
				position: "absolute",
				opacity: "0.4",
				pointerEvents: "none",
			},
			".cm-preference-indent": {
				borderLeft:
					"1px solid color-mix(in srgb, currentColor 15%, transparent)",
				marginLeft: "-1px",
			},
		}),
		markers,
	];
}
