import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import {
	type CodexChatSettings,
	codexChatSettingsSchema,
	DEFAULT_CODEX_CHAT_SETTINGS,
} from "@superset/shared/codex-chat-settings";
import { Button } from "@superset/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	effortName,
	isPresetAvailable,
	modelName,
} from "renderer/components/CodexModelSelector/modelPresentation";
import { useCodexChatSettings } from "renderer/hooks/useCodexChatSettings";
import { useCodexModels } from "renderer/hooks/useCodexModels";
import { createCodexChatTransport } from "renderer/lib/codex-chat-transport";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export function CodexChatSettingsPage() {
	const { t } = useLingui();
	const query = useCodexChatSettings();
	const { activeHostUrl } = useLocalHostService();
	const transport = useMemo(
		() => (activeHostUrl ? createCodexChatTransport(activeHostUrl) : null),
		[activeHostUrl],
	);
	const catalog = useCodexModels(transport, activeHostUrl);
	const [draft, setDraft] = useState<CodexChatSettings | null>(null);
	const [error, setError] = useState<string | null>(null);
	const value = draft ?? query.settings;
	const mutation = electronTrpc.settings.setCodexChat.useMutation();
	const utils = electronTrpc.useUtils();
	function updatePreset(
		index: number,
		modelId: string,
		reasoningEffort: string,
	) {
		setDraft({
			...value,
			presets: value.presets.map((preset, i) =>
				i === index ? { ...preset, modelId, reasoningEffort } : preset,
			),
		});
	}
	function move(index: number, delta: number) {
		const presets = [...value.presets];
		const other = index + delta;
		const current = presets[index];
		const target = presets[other];
		if (!current || !target) return;
		presets[index] = target;
		presets[other] = current;
		setDraft({ ...value, presets });
	}
	const valid = codexChatSettingsSchema.safeParse(value).success;
	async function save() {
		setError(null);
		try {
			await mutation.mutateAsync(value);
			await utils.settings.getCodexChat.invalidate();
			setDraft(null);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	}
	return (
		<div className="mx-auto max-w-3xl space-y-8 p-6 [&_button]:min-h-10">
			<header className="space-y-2">
				<h1 className="text-xl font-semibold text-balance">
					<Trans>Codex Chat</Trans>
				</h1>
				<p className="text-sm text-muted-foreground text-pretty">
					<Trans>
						Choose the default for new chats and customize your model shortcuts.
						Existing chats keep their selections.
					</Trans>
				</p>
			</header>
			{(query.error || catalog.error || error) && (
				<p role="alert" className="text-sm text-destructive">
					{error ?? errorMessage(query.error ?? catalog.error)}
				</p>
			)}
			{!activeHostUrl && (
				<output className="text-sm text-muted-foreground">
					<Trans>Connect a host to load Codex models.</Trans>
				</output>
			)}
			<section className="space-y-3">
				<h2 className="font-medium">
					<Trans>Default model</Trans>
				</h2>
				<Select
					value={value.defaultPresetId}
					onValueChange={(defaultPresetId) =>
						setDraft({ ...value, defaultPresetId })
					}
					disabled={mutation.isPending || query.isPending}
				>
					<SelectTrigger
						aria-label={t({ message: "Default model" })}
						className="min-h-10"
					>
						<SelectValue
							placeholder={t({ message: "Select a default preset" })}
						/>
					</SelectTrigger>
					<SelectContent>
						{value.presets.map((preset) => (
							<SelectItem key={preset.id} value={preset.id}>
								{modelName(preset.modelId)}{" "}
								{effortName(preset.reasoningEffort, preset.modelId)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</section>
			<section className="space-y-3">
				<h2 className="font-medium">
					<Trans>Model shortcuts</Trans>
				</h2>
				{value.presets.map((preset, index) => (
					<div
						key={preset.id}
						className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/30 p-3"
					>
						<span className="w-5 text-xs tabular-nums text-muted-foreground">
							{index + 1}
						</span>
						<Select
							value={preset.modelId}
							disabled={!catalog.data || mutation.isPending}
							onValueChange={(modelId) => {
								const model = catalog.data?.find(
									(item) => item.model === modelId,
								);
								if (model)
									updatePreset(index, modelId, model.defaultReasoningEffort);
							}}
						>
							<SelectTrigger
								aria-label={t({ message: "Model" })}
								className="min-h-10 min-w-32 flex-1"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{!catalog.data?.some(
									(model) => model.model === preset.modelId,
								) && (
									<SelectItem value={preset.modelId} disabled>
										{modelName(preset.modelId)}
									</SelectItem>
								)}
								{catalog.data?.map((model) => (
									<SelectItem key={model.model} value={model.model}>
										{model.displayName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={preset.reasoningEffort}
							disabled={!catalog.data || mutation.isPending}
							onValueChange={(effort) =>
								updatePreset(index, preset.modelId, effort)
							}
						>
							<SelectTrigger
								aria-label={t({ message: "Reasoning effort" })}
								className="min-h-10 w-32"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{catalog.data
									?.find((model) => model.model === preset.modelId)
									?.supportedReasoningEfforts.map((effort) => (
										<SelectItem
											key={effort.reasoningEffort}
											value={effort.reasoningEffort}
										>
											{effortName(effort.reasoningEffort, preset.modelId)}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
						<Button
							size="icon"
							variant="ghost"
							className="size-10"
							disabled={index === 0 || mutation.isPending}
							onClick={() => move(index, -1)}
							aria-label={t({ message: "Move up" })}
						>
							<ArrowUp className="size-4" />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							className="size-10"
							disabled={
								index === value.presets.length - 1 || mutation.isPending
							}
							onClick={() => move(index, 1)}
							aria-label={t({ message: "Move down" })}
						>
							<ArrowDown className="size-4" />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							className="size-10"
							disabled={value.presets.length === 1 || mutation.isPending}
							onClick={() =>
								setDraft({
									...value,
									defaultPresetId:
										value.defaultPresetId === preset.id
											? ""
											: value.defaultPresetId,
									presets: value.presets.filter((p) => p.id !== preset.id),
								})
							}
							aria-label={t({ message: "Remove" })}
						>
							<Trash2 className="size-4" />
						</Button>
						{catalog.data && !isPresetAvailable(preset, catalog.data) && (
							<p className="w-full text-xs text-muted-foreground">
								<Trans>Unavailable on this host</Trans>
							</p>
						)}
					</div>
				))}
				<Button
					variant="outline"
					disabled={!catalog.data?.length || mutation.isPending}
					onClick={() => {
						const model = catalog.data?.[0];
						if (model)
							setDraft({
								...value,
								presets: [
									...value.presets,
									{
										id: crypto.randomUUID(),
										modelId: model.model,
										reasoningEffort: model.defaultReasoningEffort,
									},
								],
							});
					}}
				>
					<Plus className="mr-2 size-4" />
					<Trans>Add model shortcut</Trans>
				</Button>
			</section>
			{!valid && (
				<p role="alert" className="text-sm text-destructive">
					<Trans>Select a default preset</Trans>
				</p>
			)}
			<footer className="flex flex-wrap justify-end gap-2">
				<Button
					variant="ghost"
					disabled={mutation.isPending}
					onClick={() => setDraft(structuredClone(DEFAULT_CODEX_CHAT_SETTINGS))}
				>
					<Trans>Restore defaults</Trans>
				</Button>
				<Button
					variant="outline"
					disabled={mutation.isPending}
					onClick={() => {
						setDraft(null);
						setError(null);
					}}
				>
					<Trans>Cancel</Trans>
				</Button>
				<Button
					disabled={!draft || !valid || mutation.isPending || query.isPending}
					onClick={() => void save()}
				>
					<Trans>Save</Trans>
				</Button>
			</footer>
		</div>
	);
}
