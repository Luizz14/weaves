import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import {
	DEFAULT_EDITOR_SETTINGS,
	EDITOR_LANGUAGES,
	type EditorSettings,
	editorPaletteSchema,
	editorSettingsSchema,
} from "@superset/shared/editor-settings";
import {
	builtInThemes,
	getEditorTheme,
	toHexAuto,
} from "@superset/shared/themes";
import {
	setSettingsValue,
	settingsValue,
} from "@superset/shared/zed-editor-import";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { EDITOR_SETTINGS_QUERY_KEY } from "renderer/hooks/useEditorSettings";
import { FONT_SETTINGS_QUERY_KEY } from "renderer/lib/font-settings";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { EditorSettingField } from "./components/EditorSettingField";
import { LspSettings } from "./components/LspSettings";
import { ZedImport } from "./components/ZedImport";
import { type EditorField, useEditorFields } from "./fields";

export function CodeEditorSettings() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: EDITOR_SETTINGS_QUERY_KEY,
		queryFn: () => electronTrpcClient.settings.editor.get.query(),
	});
	const [draft, setDraft] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
	const [language, setLanguage] = useState("typescript");
	const [pending, setPending] = useState(false);
	const groups = useEditorFields();
	useEffect(() => {
		if (query.data) setDraft(query.data);
	}, [query.data]);
	const refresh = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: EDITOR_SETTINGS_QUERY_KEY }),
			queryClient.invalidateQueries({ queryKey: FONT_SETTINGS_QUERY_KEY }),
		]);
	};
	const update = (path: string, value: unknown) =>
		setDraft((previous) => {
			const next = structuredClone(previous);
			setSettingsValue(next, path, value);
			return next;
		});
	const save = async () => {
		setPending(true);
		try {
			await electronTrpcClient.settings.editor.set.mutate(
				editorSettingsSchema.parse(draft),
			);
			await refresh();
			toast.success(t({ message: "Editor settings saved" }));
		} catch (error) {
			toast.error(
				errorMessage(error, t({ message: "Could not save editor settings" })),
			);
		} finally {
			setPending(false);
		}
	};
	const renderField = (field: EditorField, group: string, override = false) => {
		const path = override
			? `languages.${language}.${group}.${field.key}`
			: `${group}.${field.key}`;
		const value = settingsValue(draft, path);
		const inherit = t({ message: "Inherit global preference" });
		if (!override)
			return (
				<EditorSettingField
					{...field}
					key={path}
					value={value}
					disabled={pending}
					onChange={(next) => update(path, next)}
				/>
			);
		if (field.kind === "boolean" || field.kind === "choice")
			return (
				<EditorSettingField
					key={path}
					label={field.label}
					kind="choice"
					value={value === undefined ? "inherit" : String(value)}
					disabled={pending}
					options={[
						{ value: "inherit", label: inherit },
						...(field.kind === "boolean"
							? [
									{ value: "true", label: t({ message: "On" }) },
									{ value: "false", label: t({ message: "Off" }) },
								]
							: (field.options ?? [])),
					]}
					onChange={(next) =>
						updateOverride(
							path,
							next === "inherit"
								? undefined
								: field.kind === "boolean"
									? next === "true"
									: next,
						)
					}
				/>
			);
		return (
			<EditorSettingField
				{...field}
				key={path}
				label={`${field.label} (${inherit})`}
				value={value}
				disabled={pending}
				onChange={(next) =>
					updateOverride(path, next === null ? undefined : next)
				}
			/>
		);
	};
	const updateOverride = (path: string, value: unknown) =>
		setDraft((previous) => {
			const next = structuredClone(previous);
			const known = EDITOR_LANGUAGES.find((id) => id === language);
			if (!known) return previous;
			if (!next.languages[known])
				next.languages[known] = {
					editing: {},
					saving: {},
					hints: {},
					enableLanguageServer: true,
				};
			if (value === undefined) {
				const parts = path.split(".");
				const parent = settingsValue(next, parts.slice(0, -1).join("."));
				if (parent && typeof parent === "object")
					Reflect.deleteProperty(parent, parts.at(-1) ?? "");
			} else setSettingsValue(next, path, value);
			return next;
		});
	const chooseTheme = (value: unknown) => {
		if (value === "inherit") {
			update("appearance.theme", "inherit");
			return;
		}
		const theme = builtInThemes.find((theme) => theme.id === value);
		if (!theme) {
			update("appearance.theme", "custom");
			return;
		}
		const palette = getEditorTheme(theme);
		const normalize = (colors: Record<string, string>) =>
			Object.fromEntries(
				Object.entries(colors).map(([key, color]) => [key, toHexAuto(color)]),
			);
		update(
			"appearance.palette",
			editorPaletteSchema.parse({
				name: theme.name,
				type: theme.type,
				colors: normalize({ ...palette.colors }),
				syntax: normalize({ ...palette.syntax }),
			}),
		);
		update("appearance.theme", "custom");
	};
	return (
		<div className="mx-auto w-full max-w-4xl p-6 select-text space-y-6">
			<header className="flex items-start justify-between gap-4">
				<div>
					<h2 className="text-xl font-semibold">
						<Trans>Code Editor</Trans>
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						<Trans>
							Appearance, editing, project tools, and language preferences for
							the v2 editor.
						</Trans>
					</p>
				</div>
				<Button
					onClick={() => void save()}
					disabled={pending || query.isLoading}
				>
					<Trans>Save settings</Trans>
				</Button>
			</header>
			<nav
				className="flex flex-wrap gap-1"
				aria-label={t({ message: "Editor settings sections" })}
			>
				{groups.map((group) => (
					<Button
						key={group.id}
						variant="ghost"
						size="sm"
						onClick={() =>
							document
								.getElementById(`editor-${group.id}`)
								?.scrollIntoView({ behavior: "auto" })
						}
					>
						{group.label}
					</Button>
				))}
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						document
							.getElementById("editor-languages")
							?.scrollIntoView({ behavior: "auto" })
					}
				>
					<Trans>Language overrides</Trans>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						document
							.getElementById("zed-import-title")
							?.scrollIntoView({ behavior: "auto" })
					}
				>
					<Trans>Import from Zed</Trans>
				</Button>
			</nav>
			{query.isError && (
				<p role="alert" className="text-sm text-destructive">
					{errorMessage(
						query.error,
						t({ message: "Could not load editor settings" }),
					)}
				</p>
			)}
			{groups.map((group) => (
				<section
					id={`editor-${group.id}`}
					key={group.id}
					className="rounded-lg border p-4"
				>
					<h3 className="mb-2 text-sm font-semibold">{group.label}</h3>
					{group.fields.map((field) => renderField(field, group.id))}
					{group.id === "appearance" && (
						<EditorSettingField
							label={t({ message: "Editor theme" })}
							kind="choice"
							value={
								draft.appearance.theme === "inherit"
									? "inherit"
									: (builtInThemes.find(
											(theme) => theme.name === draft.appearance.palette?.name,
										)?.id ?? "custom")
							}
							options={[
								{
									value: "inherit",
									label: t({ message: "Inherit application theme" }),
								},
								...builtInThemes.map((theme) => ({
									value: theme.id,
									label: theme.name,
								})),
								...(draft.appearance.palette
									? [{ value: "custom", label: draft.appearance.palette.name }]
									: []),
							]}
							onChange={chooseTheme}
						/>
					)}
				</section>
			))}
			<section
				id="editor-languages"
				className="rounded-lg border p-4 space-y-3"
			>
				<h3 className="text-sm font-semibold">
					<Trans>Language overrides</Trans>
				</h3>
				<EditorSettingField
					label={t({ message: "Programming language" })}
					kind="choice"
					value={language}
					options={EDITOR_LANGUAGES.map((id) => ({ value: id, label: id }))}
					onChange={(value) => setLanguage(String(value))}
				/>
				<EditorSettingField
					label={t({ message: "Enable language server" })}
					kind="boolean"
					value={
						settingsValue(
							draft,
							`languages.${language}.enableLanguageServer`,
						) ?? true
					}
					onChange={(value) =>
						updateOverride(`languages.${language}.enableLanguageServer`, value)
					}
				/>
				{groups
					.filter((group) => ["editing", "saving", "hints"].includes(group.id))
					.map((group) => (
						<details key={group.id}>
							<summary className="cursor-pointer text-sm font-medium">
								{group.label}
							</summary>
							{group.fields.map((field) => renderField(field, group.id, true))}
						</details>
					))}
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						setDraft((previous) => {
							const next = structuredClone(previous);
							Reflect.deleteProperty(next.languages, language);
							return next;
						})
					}
				>
					<Trans>Reset language overrides</Trans>
				</Button>
			</section>
			<LspSettings />
			<ZedImport onImported={() => void refresh()} />
		</div>
	);
}
