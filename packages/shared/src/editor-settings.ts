import { z } from "zod";

export const EDITOR_LANGUAGES = [
	"typescript",
	"javascript",
	"dart",
	"kotlin",
	"json",
	"xml",
	"yaml",
	"markdown",
	"python",
	"rust",
	"go",
	"java",
	"c",
	"cpp",
	"css",
	"html",
	"sql",
	"php",
	"ruby",
	"swift",
	"shell",
	"toml",
	"graphql",
	"plaintext",
] as const;
export type EditorLanguage = (typeof EDITOR_LANGUAGES)[number];
export const FORMATTERS = [
	"auto",
	"biome",
	"prettier",
	"dart",
	"lsp",
	"none",
] as const;

const color = z
	.string()
	.regex(/^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/);
const colorKeys = [
	"background",
	"foreground",
	"border",
	"cursor",
	"gutterBackground",
	"gutterForeground",
	"activeLine",
	"selection",
	"search",
	"searchActive",
	"panel",
	"panelBorder",
	"panelInputBackground",
	"panelInputForeground",
	"panelInputBorder",
	"panelButtonBackground",
	"panelButtonForeground",
	"panelButtonBorder",
	"diffBuffer",
	"diffHover",
	"diffSeparator",
	"addition",
	"deletion",
	"modified",
] as const;
const syntaxKeys = [
	"plainText",
	"comment",
	"keyword",
	"string",
	"number",
	"functionCall",
	"variableName",
	"typeName",
	"className",
	"constant",
	"regexp",
	"tagName",
	"attributeName",
	"invalid",
] as const;
export const editorPaletteSchema = z.object({
	name: z.string().min(1).max(100),
	type: z.enum(["dark", "light"]),
	colors: z.partialRecord(z.enum(colorKeys), color),
	syntax: z.partialRecord(z.enum(syntaxKeys), color),
});

const appearanceSchema = z.object({
	fontFamily: z.string().max(200).nullable().default(null),
	fontSize: z.number().min(10).max(24).nullable().default(null),
	fontWeight: z.number().int().min(100).max(900).nullable().default(null),
	lineHeight: z.number().min(1).max(2.5).nullable().default(null),
	letterSpacing: z.number().min(-2).max(5).nullable().default(null),
	ligatures: z.boolean().nullable().default(null),
	theme: z.enum(["inherit", "custom"]).default("inherit"),
	palette: editorPaletteSchema.nullable().default(null),
});
export const editingSchema = z.object({
	tabSize: z.number().int().min(1).max(16).default(4),
	hardTabs: z.boolean().default(false),
	softWrap: z.enum(["none", "editor_width", "bounded"]).default("none"),
	preferredLineLength: z.number().int().min(40).max(240).default(80),
	whitespace: z.enum(["none", "selection", "all"]).default("none"),
	lineNumbers: z.enum(["absolute", "relative", "off"]).default("absolute"),
	highlightActiveLine: z.boolean().default(true),
	indentGuides: z.boolean().default(false),
	cursorBlink: z.boolean().default(true),
});
export const savingSchema = z.object({
	autosave: z.enum(["off", "focus", "window", "delay"]).default("off"),
	delayMs: z.number().int().min(300).max(60_000).default(500),
	formatOnSave: z.boolean().default(false),
	formatter: z.enum(FORMATTERS).default("auto"),
});
export const hintsSchema = z.object({
	enabled: z.boolean().default(false),
	types: z.boolean().default(true),
	parameters: z.boolean().default(true),
	other: z.boolean().default(true),
});
const panelSchema = z.object({
	density: z.enum(["comfortable", "standard"]).default("comfortable"),
	indent: z.number().int().min(8).max(32).default(20),
	icons: z.boolean().default(true),
	compactFolders: z.boolean().default(true),
	hideRoot: z.boolean().default(true),
	hideHidden: z.boolean().default(true),
	hideIgnored: z.boolean().default(true),
	indentGuides: z.boolean().default(false),
	stickyScroll: z.boolean().default(false),
	autoReveal: z.boolean().default(true),
	scrollbar: z.enum(["auto", "never", "always"]).default("never"),
	gitStatus: z.boolean().default(true),
	diagnostics: z.boolean().default(true),
	boldFolders: z.boolean().default(false),
});
const languageEditing = z.object({
	tabSize: editingSchema.shape.tabSize.removeDefault().optional(),
	hardTabs: editingSchema.shape.hardTabs.removeDefault().optional(),
	softWrap: editingSchema.shape.softWrap.removeDefault().optional(),
	preferredLineLength: editingSchema.shape.preferredLineLength
		.removeDefault()
		.optional(),
	whitespace: editingSchema.shape.whitespace.removeDefault().optional(),
	lineNumbers: editingSchema.shape.lineNumbers.removeDefault().optional(),
	highlightActiveLine: editingSchema.shape.highlightActiveLine
		.removeDefault()
		.optional(),
	indentGuides: editingSchema.shape.indentGuides.removeDefault().optional(),
	cursorBlink: editingSchema.shape.cursorBlink.removeDefault().optional(),
});
const languageSaving = z.object({
	autosave: savingSchema.shape.autosave.removeDefault().optional(),
	delayMs: savingSchema.shape.delayMs.removeDefault().optional(),
	formatOnSave: savingSchema.shape.formatOnSave.removeDefault().optional(),
	formatter: savingSchema.shape.formatter.removeDefault().optional(),
});
const languageHints = z.object({
	enabled: hintsSchema.shape.enabled.removeDefault().optional(),
	types: hintsSchema.shape.types.removeDefault().optional(),
	parameters: hintsSchema.shape.parameters.removeDefault().optional(),
	other: hintsSchema.shape.other.removeDefault().optional(),
});
const languageOverrideSchema = z.object({
	editing: languageEditing.default({}),
	saving: languageSaving.default({}),
	hints: languageHints.default({}),
	enableLanguageServer: z.boolean().default(true),
});

export const editorSettingsSchema = z.object({
	appearance: appearanceSchema.default(() => appearanceSchema.parse({})),
	editing: editingSchema.default(() => editingSchema.parse({})),
	saving: savingSchema.default(() => savingSchema.parse({})),
	hints: hintsSchema.default(() => hintsSchema.parse({})),
	panel: panelSchema.default(() => panelSchema.parse({})),
	languages: z
		.partialRecord(z.enum(EDITOR_LANGUAGES), languageOverrideSchema)
		.default({}),
});
export type EditorSettings = z.infer<typeof editorSettingsSchema>;
export type EditorPalette = z.infer<typeof editorPaletteSchema>;
export const DEFAULT_EDITOR_SETTINGS: EditorSettings =
	editorSettingsSchema.parse({});

export function resolveEditorSettings(
	settings: EditorSettings,
	language: string,
) {
	const known = EDITOR_LANGUAGES.find((candidate) => candidate === language);
	const override = known ? settings.languages[known] : undefined;
	return {
		...settings,
		editing: { ...settings.editing, ...override?.editing },
		saving: { ...settings.saving, ...override?.saving },
		hints: { ...settings.hints, ...override?.hints },
		enableLanguageServer: override?.enableLanguageServer ?? true,
	};
}
