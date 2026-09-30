import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { settings } from "@superset/local-db";
import {
	type EditorSettings,
	editorSettingsSchema,
} from "@superset/shared/editor-settings";
import {
	applyZedEditorPreview,
	convertZedTheme,
	previewZedEditorSettings,
} from "@superset/shared/zed-editor-import";
import { TRPCError } from "@trpc/server";
import { dialog } from "electron";
import JSON5 from "json5";
import { localDb } from "main/lib/local-db";
import { z } from "zod";
import { publicProcedure, router } from "../../..";

function getEditorSettings(): EditorSettings {
	const row = localDb.select().from(settings).get();
	const result = editorSettingsSchema.parse(row?.editorSettings ?? {});
	result.appearance = {
		...result.appearance,
		fontFamily: row?.editorFontFamily ?? null,
		fontSize: row?.editorFontSize ?? null,
		fontWeight: row?.editorFontWeight ?? null,
		lineHeight: row?.editorLineHeight ?? null,
		letterSpacing: row?.editorLetterSpacing ?? null,
		ligatures: row?.editorLigatures ?? null,
	};
	return result;
}

function saveEditorSettings(value: EditorSettings): void {
	const appearance = value.appearance;
	const update = {
		editorSettings: value,
		editorFontFamily: appearance.fontFamily,
		editorFontSize: appearance.fontSize,
		editorFontWeight: appearance.fontWeight,
		editorLineHeight: appearance.lineHeight,
		editorLetterSpacing: appearance.letterSpacing,
		editorLigatures: appearance.ligatures,
	};
	localDb
		.insert(settings)
		.values({ id: 1, ...update })
		.onConflictDoUpdate({ target: settings.id, set: update })
		.run();
}

async function readJson(path: string) {
	if ((await stat(path)).size > 2 * 1024 * 1024)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Configuration file exceeds 2 MB",
		});
	const raw = await readFile(path, "utf8");
	return {
		raw,
		value: z.record(z.string(), z.unknown()).parse(JSON5.parse(raw)),
	};
}

function zedConfigPath() {
	return join(
		process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
		"zed",
		"settings.json",
	);
}

async function readPreview(path = zedConfigPath()) {
	const source = await readJson(path);
	let name: string | null =
		typeof source.value.theme === "string" ? source.value.theme : null;
	const mode = z
		.object({ mode: z.string(), dark: z.string(), light: z.string() })
		.safeParse(source.value.theme);
	if (mode.success)
		name = mode.data.mode === "light" ? mode.data.light : mode.data.dark;
	let palette: ReturnType<typeof convertZedTheme> = null;
	if (name) {
		const dataPath =
			process.platform === "darwin"
				? join(homedir(), "Library", "Application Support", "Zed")
				: process.platform === "win32"
					? join(process.env.LOCALAPPDATA || homedir(), "Zed")
					: join(
							process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
							"zed",
						);
		const directories = [join(dirname(path), "themes")];
		try {
			for (const extension of await readdir(
				join(dataPath, "extensions", "installed"),
				{ withFileTypes: true },
			))
				if (extension.isDirectory())
					directories.push(
						join(dataPath, "extensions", "installed", extension.name, "themes"),
					);
		} catch {}
		for (const directory of directories) {
			try {
				for (const file of await readdir(directory)) {
					if (!file.endsWith(".json")) continue;
					const theme = await readJson(join(directory, file));
					palette = convertZedTheme(theme.value, name);
					if (palette) break;
				}
			} catch {}
			if (palette) break;
		}
	}
	const preview = previewZedEditorSettings(
		source.value,
		getEditorSettings(),
		palette,
	);
	return {
		...preview,
		path,
		hash: createHash("sha256")
			.update(source.raw)
			.update(JSON.stringify(palette))
			.digest("hex"),
		themeFound: !name || !!palette,
	};
}

export const editorSettingsRouter = router({
	get: publicProcedure.query(getEditorSettings),
	set: publicProcedure.input(editorSettingsSchema).mutation(({ input }) => {
		saveEditorSettings(input);
		return input;
	}),
	pickImportFile: publicProcedure.mutation(async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile"],
			filters: [{ name: "JSON", extensions: ["json", "jsonc", "json5"] }],
		});
		return result.canceled ? null : (result.filePaths[0] ?? null);
	}),
	previewImport: publicProcedure
		.input(z.object({ path: z.string().max(4096).optional() }))
		.query(({ input }) => readPreview(input.path)),
	applyImport: publicProcedure
		.input(
			z.object({
				path: z.string().max(4096),
				hash: z.string(),
				selected: z.array(z.string()).max(256),
			}),
		)
		.mutation(async ({ input }) => {
			const preview = await readPreview(input.path);
			if (preview.hash !== input.hash)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Zed configuration changed; refresh the preview",
				});
			const next = applyZedEditorPreview(
				getEditorSettings(),
				preview,
				input.selected,
			);
			saveEditorSettings(next);
			return next;
		}),
});
