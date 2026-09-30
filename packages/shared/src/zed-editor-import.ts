import { z } from "zod";
import {
	EDITOR_LANGUAGES,
	type EditorPalette,
	type EditorSettings,
	editorPaletteSchema,
	editorSettingsSchema,
} from "./editor-settings";

type ImportEntry = {
	path: string;
	source: string;
	current: unknown;
	value: unknown;
	compatible: boolean;
	reason?: string;
};
export type ZedEditorPreview = {
	entries: ImportEntry[];
	candidate: EditorSettings;
};

export function settingsValue(settings: EditorSettings, path: string): unknown {
	let value: unknown = settings;
	for (const key of path.split(".")) {
		if (!value || typeof value !== "object") return undefined;
		value = Reflect.get(value, key);
	}
	return value;
}

export function setSettingsValue(
	settings: EditorSettings,
	path: string,
	value: unknown,
): void {
	let object: object = settings;
	const parts = path.split(".");
	for (const key of parts.slice(0, -1)) {
		let child: unknown = Reflect.get(object, key);
		if (!child || typeof child !== "object") {
			child = {};
			Reflect.set(object, key, child);
		}
		if (child && typeof child === "object") object = child;
	}
	const last = parts.at(-1);
	if (last) Reflect.set(object, last, value);
}

export function convertZedTheme(
	input: unknown,
	name: string,
): EditorPalette | null {
	const family = z
		.object({
			themes: z.array(
				z.object({
					name: z.string(),
					appearance: z.enum(["dark", "light"]),
					style: z.record(z.string(), z.unknown()),
				}),
			),
		})
		.safeParse(input);
	const selected = family.success
		? family.data.themes.find((theme) => theme.name === name)
		: null;
	if (!selected) return null;
	const style = selected.style;
	const colors: Record<string, string> = {};
	const mapping: Record<string, string> = {
		"editor.background": "background",
		"editor.foreground": "foreground",
		border: "border",
		"editor.active_line.background": "activeLine",
		"editor.line_number": "gutterForeground",
		"editor.gutter.background": "gutterBackground",
		"search.match_background": "search",
		"search.active_match_background": "searchActive",
		"panel.background": "panel",
		created: "addition",
		modified: "modified",
		deleted: "deletion",
	};
	for (const [source, target] of Object.entries(mapping))
		if (typeof style[source] === "string")
			colors[target] = String(style[source]);
	if (!colors.foreground && typeof style.text === "string")
		colors.foreground = style.text;
	const players = z
		.array(
			z.object({
				cursor: z.string().optional(),
				selection: z.string().optional(),
			}),
		)
		.safeParse(style.players);
	if (players.success && players.data[0]) {
		if (players.data[0].cursor) colors.cursor = players.data[0].cursor;
		if (players.data[0].selection) colors.selection = players.data[0].selection;
	}
	const syntax: Record<string, string> = {};
	if (colors.foreground) syntax.plainText = colors.foreground;
	const sourceSyntax = z
		.record(z.string(), z.object({ color: z.string().nullable().optional() }))
		.safeParse(style.syntax);
	const tokens: Record<string, string> = {
		comment: "comment",
		keyword: "keyword",
		string: "string",
		number: "number",
		function: "functionCall",
		variable: "variableName",
		type: "typeName",
		"type.builtin": "className",
		constant: "constant",
		"string.regex": "regexp",
		tag: "tagName",
		attribute: "attributeName",
	};
	if (sourceSyntax.success)
		for (const [source, target] of Object.entries(tokens)) {
			const value = sourceSyntax.data[source]?.color;
			if (value) syntax[target] = value;
		}
	const palette = editorPaletteSchema.safeParse({
		name,
		type: selected.appearance,
		colors,
		syntax,
	});
	return palette.success ? palette.data : null;
}

export function previewZedEditorSettings(
	input: unknown,
	current: EditorSettings,
	palette?: EditorPalette | null,
): ZedEditorPreview {
	const source = z.record(z.string(), z.unknown()).parse(input);
	let candidate = structuredClone(current);
	const entries: ImportEntry[] = [];
	const add = (path: string, sourceKey: string, value: unknown) => {
		const next = structuredClone(candidate);
		setSettingsValue(next, path, value);
		const parsed = editorSettingsSchema.safeParse(next);
		entries.push({
			path,
			source: sourceKey,
			current: settingsValue(current, path),
			value,
			compatible: parsed.success,
			...(parsed.success ? {} : { reason: "invalid-value" }),
		});
		if (parsed.success) candidate = parsed.data;
	};
	const map: Record<string, string> = {
		buffer_font_family: "appearance.fontFamily",
		buffer_font_size: "appearance.fontSize",
		buffer_font_weight: "appearance.fontWeight",
		tab_size: "editing.tabSize",
		hard_tabs: "editing.hardTabs",
		preferred_line_length: "editing.preferredLineLength",
		cursor_blink: "editing.cursorBlink",
	};
	for (const [key, path] of Object.entries(map))
		if (key in source) add(path, key, source[key]);
	if ("buffer_line_height" in source) {
		const height = source.buffer_line_height;
		const value =
			height === "comfortable"
				? 1.618
				: height === "standard"
					? 1.3
					: z.object({ custom: z.number() }).safeParse(height).success
						? Reflect.get(Object(height), "custom")
						: height;
		add("appearance.lineHeight", "buffer_line_height", value);
	}
	const fontFeatures = z
		.record(z.string(), z.boolean())
		.safeParse(source.buffer_font_features);
	if (fontFeatures.success)
		add(
			"appearance.ligatures",
			"buffer_font_features",
			fontFeatures.data.calt !== false && fontFeatures.data.liga !== false,
		);
	const editingMap: Record<string, string> = {
		soft_wrap: "softWrap",
		show_whitespaces: "whitespace",
		relative_line_numbers: "lineNumbers",
	};
	for (const [key, field] of Object.entries(editingMap))
		if (key in source) {
			let value = source[key];
			if (key === "soft_wrap" && value === "preferred_line_length")
				value = "bounded";
			if (key === "relative_line_numbers")
				value =
					value === "enabled"
						? "relative"
						: value === "disabled"
							? "absolute"
							: value;
			add(`editing.${field}`, key, value);
		}
	const formatterMap: Record<string, string> = {
		auto: "auto",
		language_server: "lsp",
		prettier: "prettier",
		biome: "biome",
		dart: "dart",
		none: "none",
	};
	const mapBehavior = (
		object: Record<string, unknown>,
		prefix: string,
		sourcePrefix: string,
	) => {
		if ("formatter" in object) {
			const value = object.formatter;
			if (typeof value === "string" && formatterMap[value])
				add(
					`${prefix}saving.formatter`,
					`${sourcePrefix}formatter`,
					formatterMap[value],
				);
			else
				entries.push({
					path: `${prefix}saving.formatter`,
					source: `${sourcePrefix}formatter`,
					current: settingsValue(current, `${prefix}saving.formatter`),
					value: "external-or-unsupported",
					compatible: false,
					reason: "unsupported-formatter",
				});
		}
		if ("format_on_save" in object)
			add(
				`${prefix}saving.formatOnSave`,
				`${sourcePrefix}format_on_save`,
				object.format_on_save === "on"
					? true
					: object.format_on_save === "off"
						? false
						: object.format_on_save,
			);
		if ("autosave" in object) {
			const auto = object.autosave;
			const delay = z
				.object({ after_delay: z.object({ milliseconds: z.number() }) })
				.safeParse(auto);
			add(
				`${prefix}saving.autosave`,
				`${sourcePrefix}autosave`,
				delay.success
					? "delay"
					: auto === "on_focus_change"
						? "focus"
						: auto === "on_window_change"
							? "window"
							: auto,
			);
			if (delay.success)
				add(
					`${prefix}saving.delayMs`,
					`${sourcePrefix}autosave.after_delay.milliseconds`,
					delay.data.after_delay.milliseconds,
				);
		}
		const hints = z
			.record(z.string(), z.unknown())
			.safeParse(object.inlay_hints);
		if (hints.success) {
			for (const [key, field] of Object.entries({
				enabled: "enabled",
				show_type_hints: "types",
				show_parameter_hints: "parameters",
				show_other_hints: "other",
			}))
				if (key in hints.data)
					add(
						`${prefix}hints.${field}`,
						`${sourcePrefix}inlay_hints.${key}`,
						hints.data[key],
					);
			if (hints.data.show_value_hints === true)
				entries.push({
					path: `${prefix}hints.value`,
					source: `${sourcePrefix}inlay_hints.show_value_hints`,
					current: null,
					value: true,
					compatible: false,
					reason: "unsupported-value-hints",
				});
		}
	};
	mapBehavior(source, "", "");
	const panel = z
		.record(z.string(), z.unknown())
		.safeParse(source.project_panel);
	if (panel.success) {
		const fields: Record<string, string> = {
			entry_spacing: "density",
			indent_size: "indent",
			file_icons: "icons",
			hide_root: "hideRoot",
			hide_hidden: "hideHidden",
			hide_gitignore: "hideIgnored",
			sticky_scroll: "stickyScroll",
			auto_fold_dirs: "compactFolders",
			auto_reveal_entries: "autoReveal",
			bold_folder_labels: "boldFolders",
			git_status_indicator: "gitStatus",
			diagnostic_badges: "diagnostics",
		};
		for (const [key, field] of Object.entries(fields))
			if (key in panel.data)
				add(`panel.${field}`, `project_panel.${key}`, panel.data[key]);
		const guides = z
			.object({ show: z.string() })
			.safeParse(panel.data.indent_guides);
		if (guides.success)
			add(
				"panel.indentGuides",
				"project_panel.indent_guides.show",
				guides.data.show === "always",
			);
		const scrollbar = z
			.object({ show: z.string().nullable() })
			.safeParse(panel.data.scrollbar);
		if (scrollbar.success)
			add(
				"panel.scrollbar",
				"project_panel.scrollbar.show",
				scrollbar.data.show === "system" || !scrollbar.data.show
					? "auto"
					: scrollbar.data.show,
			);
	}
	const languages = z
		.record(z.string(), z.record(z.string(), z.unknown()))
		.safeParse(source.languages);
	if (languages.success)
		for (const [name, values] of Object.entries(languages.data)) {
			const id = EDITOR_LANGUAGES.find(
				(language) =>
					language ===
					name
						.toLowerCase()
						.replace("c++", "cpp")
						.replace("shell script", "shell"),
			);
			if (!id) {
				entries.push({
					path: `languages.${name}`,
					source: `languages.${name}`,
					current: null,
					value: null,
					compatible: false,
					reason: "unsupported-language",
				});
				continue;
			}
			if (!candidate.languages[id])
				candidate.languages[id] = {
					editing: {},
					saving: {},
					hints: {},
					enableLanguageServer: true,
				};
			for (const [key, field] of Object.entries({
				tab_size: "tabSize",
				hard_tabs: "hardTabs",
				preferred_line_length: "preferredLineLength",
			}))
				if (key in values)
					add(
						`languages.${id}.editing.${field}`,
						`languages.${name}.${key}`,
						values[key],
					);
			if ("soft_wrap" in values)
				add(
					`languages.${id}.editing.softWrap`,
					`languages.${name}.soft_wrap`,
					values.soft_wrap === "preferred_line_length"
						? "bounded"
						: values.soft_wrap,
				);
			if ("enable_language_server" in values)
				add(
					`languages.${id}.enableLanguageServer`,
					`languages.${name}.enable_language_server`,
					values.enable_language_server,
				);
			mapBehavior(values, `languages.${id}.`, `languages.${name}.`);
		}
	if (palette) {
		add("appearance.palette", "theme", palette);
		add("appearance.theme", "theme", "custom");
	}
	return { entries, candidate };
}

export function applyZedEditorPreview(
	current: EditorSettings,
	preview: ZedEditorPreview,
	selected: readonly string[],
): EditorSettings {
	const next = structuredClone(current);
	for (const entry of preview.entries)
		if (entry.compatible && selected.includes(entry.path))
			setSettingsValue(next, entry.path, entry.value);
	return editorSettingsSchema.parse(next);
}
