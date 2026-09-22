import { eq } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../db";
import { hostSettings } from "../../../db/schema";
import { protectedProcedure, router } from "../../index";
import { QUICK_AI_MODELS, type QuickAiModel } from "../quick-ai/agy-cli";
import {
	getQuickAiProvider,
	type QuickAiProviderId,
} from "../quick-ai/provider";

const HOST_SETTINGS_ID = 1;

export interface QuickAiSettings {
	provider: QuickAiProviderId;
	model: QuickAiModel;
}

export function getQuickAiSettings(db: HostDb): QuickAiSettings {
	const row = db
		.select({
			provider: hostSettings.quickAiProvider,
			model: hostSettings.quickAiModel,
		})
		.from(hostSettings)
		.where(eq(hostSettings.id, HOST_SETTINGS_ID))
		.get();
	const model = QUICK_AI_MODELS.find((candidate) => candidate === row?.model);
	return { provider: "agy", model: model ?? "gemini-3.8-flash-low" };
}

export const quickAiSettingsRouter = router({
	get: protectedProcedure.query(({ ctx }) => getQuickAiSettings(ctx.db)),

	set: protectedProcedure
		.input(
			z.object({
				provider: z.literal("agy"),
				model: z.enum(QUICK_AI_MODELS),
			}),
		)
		.mutation(({ ctx, input }) => {
			ctx.db
				.insert(hostSettings)
				.values({
					id: HOST_SETTINGS_ID,
					quickAiProvider: input.provider,
					quickAiModel: input.model,
				})
				.onConflictDoUpdate({
					target: hostSettings.id,
					set: {
						quickAiProvider: input.provider,
						quickAiModel: input.model,
					},
				})
				.run();
			return input;
		}),

	status: protectedProcedure.query(async ({ ctx }) => {
		const settings = getQuickAiSettings(ctx.db);
		const version = await getQuickAiProvider(settings.provider).getVersion();
		return { installed: version !== null, version };
	}),

	testConnection: protectedProcedure.mutation(async ({ ctx }) => {
		const settings = getQuickAiSettings(ctx.db);
		const response = await getQuickAiProvider(settings.provider).runJson(
			settings.model,
			'Return only this JSON object: {"ok": true}. Do not use tools.',
			"Connection test.",
			{
				type: "object",
				properties: { ok: { type: "boolean" } },
				required: ["ok"],
				additionalProperties: false,
			},
		);
		const parsed = z.object({ ok: z.literal(true) }).parse(response);
		return parsed;
	}),
});
