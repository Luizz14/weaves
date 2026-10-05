import { useLingui } from "@lingui/react/macro";

export type EditorField = {
	key: string;
	label: string;
	kind: "boolean" | "number" | "string" | "choice";
	options?: { value: string; label: string }[];
};
export function useEditorFields() {
	const { t } = useLingui();
	const choices = (values: [string, string][]) =>
		values.map(([value, label]) => ({ value, label }));
	const groups: {
		id: "appearance" | "editing" | "saving" | "hints" | "panel";
		label: string;
		fields: EditorField[];
	}[] = [
		{
			id: "appearance",
			label: t({ message: "Editor appearance" }),
			fields: [
				{
					key: "fontFamily",
					label: t({ message: "Font family" }),
					kind: "string",
				},
				{ key: "fontSize", label: t({ message: "Font size" }), kind: "number" },
				{
					key: "fontWeight",
					label: t({ message: "Font weight" }),
					kind: "number",
				},
				{
					key: "lineHeight",
					label: t({ message: "Line height" }),
					kind: "number",
				},
				{
					key: "letterSpacing",
					label: t({ message: "Letter spacing" }),
					kind: "number",
				},
				{
					key: "ligatures",
					label: t({ message: "Ligatures" }),
					kind: "boolean",
				},
			],
		},
		{
			id: "editing",
			label: t({ message: "Editing" }),
			fields: [
				{ key: "tabSize", label: t({ message: "Tab size" }), kind: "number" },
				{
					key: "hardTabs",
					label: t({ message: "Use tabs instead of spaces" }),
					kind: "boolean",
				},
				{
					key: "softWrap",
					label: t({ message: "Line wrapping" }),
					kind: "choice",
					options: choices([
						["none", t({ message: "Off" })],
						["editor_width", t({ message: "Editor width" })],
						["bounded", t({ message: "Preferred line length" })],
					]),
				},
				{
					key: "preferredLineLength",
					label: t({ message: "Preferred line length" }),
					kind: "number",
				},
				{
					key: "whitespace",
					label: t({ message: "Show whitespace" }),
					kind: "choice",
					options: choices([
						["none", t({ message: "Off" })],
						["selection", t({ message: "Selection" })],
						["all", t({ message: "All" })],
					]),
				},
				{
					key: "lineNumbers",
					label: t({ message: "Line numbers" }),
					kind: "choice",
					options: choices([
						["absolute", t({ message: "Absolute" })],
						["relative", t({ message: "Relative" })],
						["off", t({ message: "Off" })],
					]),
				},
				{
					key: "highlightActiveLine",
					label: t({ message: "Highlight active line" }),
					kind: "boolean",
				},
				{
					key: "indentGuides",
					label: t({ message: "Indent guides" }),
					kind: "boolean",
				},
				{
					key: "cursorBlink",
					label: t({ message: "Blinking cursor" }),
					kind: "boolean",
				},
			],
		},
		{
			id: "saving",
			label: t({ message: "Saving and formatting" }),
			fields: [
				{
					key: "autosave",
					label: t({ message: "Autosave" }),
					kind: "choice",
					options: choices([
						["off", t({ message: "Off" })],
						["focus", t({ message: "On focus change" })],
						["window", t({ message: "On window change" })],
						["delay", t({ message: "After a delay" })],
					]),
				},
				{
					key: "delayMs",
					label: t({ message: "Autosave delay (ms)" }),
					kind: "number",
				},
				{
					key: "formatOnSave",
					label: t({ message: "Format on save" }),
					kind: "boolean",
				},
				{
					key: "formatter",
					label: t({ message: "Formatter" }),
					kind: "choice",
					options: choices([
						["auto", t({ message: "Automatic (project tools first)" })],
						["biome", "Biome"],
						["prettier", "Prettier"],
						["dart", "Dart"],
						["lsp", "LSP"],
						["none", t({ message: "Off" })],
					]),
				},
			],
		},
		{
			id: "hints",
			label: t({ message: "Inlay hints" }),
			fields: [
				{
					key: "enabled",
					label: t({ message: "Show inlay hints" }),
					kind: "boolean",
				},
				{ key: "types", label: t({ message: "Type hints" }), kind: "boolean" },
				{
					key: "parameters",
					label: t({ message: "Parameter hints" }),
					kind: "boolean",
				},
				{ key: "other", label: t({ message: "Other hints" }), kind: "boolean" },
			],
		},
		{
			id: "panel",
			label: t({ message: "Project panel" }),
			fields: [
				{
					key: "density",
					label: t({ message: "Entry spacing" }),
					kind: "choice",
					options: choices([
						["comfortable", t({ message: "Comfortable" })],
						["standard", t({ message: "Compact" })],
					]),
				},
				{
					key: "indent",
					label: t({ message: "Panel indentation" }),
					kind: "number",
				},
				{
					key: "icons",
					label: t({ message: "File and folder icons" }),
					kind: "boolean",
				},
				{
					key: "compactFolders",
					label: t({ message: "Compact folders" }),
					kind: "boolean",
				},
				{
					key: "hideRoot",
					label: t({ message: "Hide project root" }),
					kind: "boolean",
				},
				{
					key: "hideHidden",
					label: t({ message: "Hide hidden files" }),
					kind: "boolean",
				},
				{
					key: "hideIgnored",
					label: t({ message: "Hide Git-ignored files" }),
					kind: "boolean",
				},
				{
					key: "indentGuides",
					label: t({ message: "Indent guides" }),
					kind: "boolean",
				},
				{
					key: "stickyScroll",
					label: t({ message: "Sticky folders" }),
					kind: "boolean",
				},
				{
					key: "autoReveal",
					label: t({ message: "Reveal active file" }),
					kind: "boolean",
				},
				{
					key: "scrollbar",
					label: t({ message: "Panel scrollbar" }),
					kind: "choice",
					options: choices([
						["auto", t({ message: "Automatic" })],
						["never", t({ message: "Never" })],
						["always", t({ message: "Always" })],
					]),
				},
				{
					key: "gitStatus",
					label: t({ message: "Git indicators" }),
					kind: "boolean",
				},
				{
					key: "diagnostics",
					label: t({ message: "Diagnostic badges" }),
					kind: "boolean",
				},
				{
					key: "boldFolders",
					label: t({ message: "Bold folder labels" }),
					kind: "boolean",
				},
			],
		},
	];
	return groups;
}
