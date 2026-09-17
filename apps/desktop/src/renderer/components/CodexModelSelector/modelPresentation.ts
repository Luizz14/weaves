import { msg } from "@lingui/core/macro";
import type { CodexModel } from "@superset/chat/protocol";
import { i18n } from "@superset/i18n";
export function modelName(id: string): string {
	const names: Record<string, string> = {
		"gpt-5.6-luna": "Luna",
		"gpt-5.6-terra": "Terra",
		"gpt-5.6-sol": "Sol",
		"gpt-6-astra": "Astra",
	};
	return names[id] ?? (id || "Codex");
}
export function effortName(effort: string, modelId?: string): string {
	if (effort === "default") return i18n._(msg({ message: "Default" }));
	if (effort === "low" && modelId === "gpt-6-astra")
		return i18n._(msg({ message: "Light", context: "reasoning effort" }));
	const labels = {
		none: msg({ message: "None", context: "reasoning effort" }),
		minimal: msg({ message: "Minimal", context: "reasoning effort" }),
		low: msg({ message: "Low", context: "reasoning effort" }),
		medium: msg({ message: "Medium", context: "reasoning effort" }),
		high: msg({ message: "High", context: "reasoning effort" }),
		xhigh: msg({ message: "Extra high", context: "reasoning effort" }),
		max: msg({ message: "Max", context: "reasoning effort" }),
		ultra: msg({ message: "Ultra", context: "reasoning effort" }),
	};
	return effort in labels
		? i18n._(labels[effort as keyof typeof labels])
		: effort;
}
export function isPresetAvailable(
	preset: { modelId: string; reasoningEffort: string },
	models: CodexModel[],
): boolean {
	return models.some(
		(model) =>
			model.model === preset.modelId &&
			model.supportedReasoningEfforts.some(
				(effort) => effort.reasoningEffort === preset.reasoningEffort,
			),
	);
}

export function isExecutionAvailable(
	value: { modelId: string; reasoningEffort: string; fast: boolean },
	models: CodexModel[],
): boolean {
	return (
		(value.reasoningEffort === "default"
			? models.some((model) => model.model === value.modelId)
			: isPresetAvailable(value, models)) &&
		(!value.fast ||
			models.some(
				(model) =>
					model.model === value.modelId &&
					model.serviceTiers.some((tier) => tier.id === "priority"),
			))
	);
}
