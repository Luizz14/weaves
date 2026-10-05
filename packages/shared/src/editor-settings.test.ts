import { expect, test } from "bun:test";
import { editorSettingsSchema, resolveEditorSettings } from "./editor-settings";
import {
	applyZedEditorPreview,
	convertZedTheme,
	previewZedEditorSettings,
} from "./zed-editor-import";

test("new preferences preserve manual saving and language overrides inherit absent fields", () => {
	const settings = editorSettingsSchema.parse({
		editing: { tabSize: 8 },
		saving: { formatOnSave: true },
		languages: { xml: { saving: { formatOnSave: false } } },
	});
	expect(resolveEditorSettings(settings, "xml").editing.tabSize).toBe(8);
	expect(resolveEditorSettings(settings, "xml").saving.formatOnSave).toBe(
		false,
	);
	expect(resolveEditorSettings(settings, "dart").saving.formatOnSave).toBe(
		true,
	);
	expect(editorSettingsSchema.parse({}).saving.autosave).toBe("off");
});

test("Zed import translates units and aliases without importing unrelated private settings", () => {
	const current = editorSettingsSchema.parse({});
	const preview = previewZedEditorSettings(
		{
			buffer_font_family: "MonoLisa Nerd Font Mono",
			buffer_font_size: 12.5,
			buffer_font_weight: 600,
			buffer_line_height: "comfortable",
			soft_wrap: "preferred_line_length",
			preferred_line_length: 110,
			autosave: "on_focus_change",
			format_on_save: "on",
			languages: { XML: { format_on_save: "off" } },
			api_key: "private-value",
			agent: { token: "private-value" },
		},
		current,
	);
	expect(preview.candidate.appearance.lineHeight).toBe(1.618);
	expect(preview.candidate.editing.softWrap).toBe("bounded");
	expect(preview.candidate.saving.autosave).toBe("focus");
	expect(
		resolveEditorSettings(preview.candidate, "xml").saving.formatOnSave,
	).toBe(false);
	expect(JSON.stringify(preview)).not.toContain("private-value");
	const applied = applyZedEditorPreview(current, preview, [
		"appearance.fontSize",
		"languages.xml.saving.formatOnSave",
		"__proto__.polluted",
	]);
	expect(applied.appearance.fontSize).toBe(12.5);
	expect(applied.appearance.fontFamily).toBeNull();
	expect(applied.saving.autosave).toBe("off");
});

test("incompatible settings are excluded and theme conversion preserves editor colors", () => {
	const palette = convertZedTheme(
		{
			themes: [
				{
					name: "Example",
					appearance: "dark",
					style: {
						"editor.background": "#222222",
						text: "#f7f1ff",
						syntax: { keyword: { color: "#fc618d" } },
					},
				},
			],
		},
		"Example",
	);
	expect(palette?.colors.background).toBe("#222222");
	expect(palette?.syntax.keyword).toBe("#fc618d");
	const preview = previewZedEditorSettings(
		{
			buffer_font_size: 100,
			inlay_hints: { enabled: true, show_value_hints: true },
		},
		editorSettingsSchema.parse({}),
		palette,
	);
	expect(
		preview.entries.find((entry) => entry.path === "appearance.fontSize")
			?.compatible,
	).toBe(false);
	expect(
		preview.entries.find((entry) => entry.path === "hints.value")?.compatible,
	).toBe(false);
	expect(preview.candidate.appearance.theme).toBe("custom");
});
