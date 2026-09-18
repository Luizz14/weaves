import { expect, test } from "bun:test";
import {
	codexChatSettingsSchema,
	DEFAULT_CODEX_CHAT_SETTINGS,
} from "./codex-chat-settings";

test("default settings match the six model/effort positions", () => {
	const value = codexChatSettingsSchema.parse(DEFAULT_CODEX_CHAT_SETTINGS);
	expect(value.presets).toHaveLength(6);
	expect(
		value.presets.find((preset) => preset.id === value.defaultPresetId),
	).toMatchObject({ modelId: "gpt-5.6-terra", reasoningEffort: "medium" });
});
test("removing the default requires choosing a surviving preset", () => {
	const presets = DEFAULT_CODEX_CHAT_SETTINGS.presets.filter(
		(p) => p.id !== DEFAULT_CODEX_CHAT_SETTINGS.defaultPresetId,
	);
	expect(
		codexChatSettingsSchema.safeParse({
			presets,
			defaultPresetId: "terra-medium",
		}).success,
	).toBe(false);
	expect(
		codexChatSettingsSchema.safeParse({
			presets: [...presets].reverse(),
			defaultPresetId: presets[0]?.id,
		}).success,
	).toBe(true);
	expect(
		codexChatSettingsSchema.safeParse({ presets: [], defaultPresetId: "" })
			.success,
	).toBe(false);
});
test("preset IDs remain unique across edits and reordering", () => {
	expect(
		codexChatSettingsSchema.safeParse({
			...DEFAULT_CODEX_CHAT_SETTINGS,
			presets: [
				...DEFAULT_CODEX_CHAT_SETTINGS.presets,
				DEFAULT_CODEX_CHAT_SETTINGS.presets[0],
			],
		}).success,
	).toBe(false);
});
