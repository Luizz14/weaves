import { z } from "zod";

export const codexModelPresetSchema = z.object({
	id: z.string().min(1),
	modelId: z.string().min(1),
	reasoningEffort: z.string().min(1),
});
export const codexChatSettingsSchema = z
	.object({
		presets: z.array(codexModelPresetSchema).min(1),
		defaultPresetId: z.string().min(1),
	})
	.superRefine((value, ctx) => {
		if (!value.presets.some((preset) => preset.id === value.defaultPresetId))
			ctx.addIssue({
				code: "custom",
				message: "Select a default preset",
				path: ["defaultPresetId"],
			});
		if (
			new Set(value.presets.map((preset) => preset.id)).size !==
			value.presets.length
		)
			ctx.addIssue({
				code: "custom",
				message: "Preset IDs must be unique",
				path: ["presets"],
			});
	});
export type CodexModelPreset = z.infer<typeof codexModelPresetSchema>;
export type CodexChatSettings = z.infer<typeof codexChatSettingsSchema>;
export const DEFAULT_CODEX_CHAT_SETTINGS: CodexChatSettings = {
	defaultPresetId: "terra-medium",
	presets: [
		{ id: "luna-medium", modelId: "gpt-5.6-luna", reasoningEffort: "medium" },
		{ id: "luna-max", modelId: "gpt-5.6-luna", reasoningEffort: "max" },
		{ id: "terra-medium", modelId: "gpt-5.6-terra", reasoningEffort: "medium" },
		{ id: "sol-low", modelId: "gpt-5.6-sol", reasoningEffort: "low" },
		{ id: "sol-medium", modelId: "gpt-5.6-sol", reasoningEffort: "medium" },
		{ id: "astra-low", modelId: "gpt-6-astra", reasoningEffort: "low" },
	],
};
