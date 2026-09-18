import { z } from "zod";

export const codexExecutionSchema = z.object({
	modelId: z.string().min(1),
	reasoningEffort: z.string().min(1),
	collaborationMode: z.enum(["default", "plan"]),
	fast: z.boolean(),
});
export type CodexExecution = z.infer<typeof codexExecutionSchema>;
export const codexModelSchema = z.object({
	id: z.string(),
	model: z.string(),
	displayName: z.string(),
	supportedReasoningEfforts: z.array(
		z.object({ reasoningEffort: z.string(), description: z.string() }),
	),
	defaultReasoningEffort: z.string(),
	serviceTiers: z
		.array(
			z.object({ id: z.string(), name: z.string(), description: z.string() }),
		)
		.default([]),
});
export type CodexModel = z.infer<typeof codexModelSchema>;
export const codexGoalSchema = z.object({
	objective: z.string(),
	status: z.enum([
		"active",
		"paused",
		"blocked",
		"usageLimited",
		"budgetLimited",
		"complete",
	]),
	tokenBudget: z.number().nullable(),
	tokensUsed: z.number(),
	timeUsedSeconds: z.number(),
});
export type CodexGoal = z.infer<typeof codexGoalSchema>;
export const codexGoalActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("set"),
		objective: z.string().trim().min(1).max(4000),
	}),
	z.object({ action: z.enum(["pause", "resume", "clear"]) }),
]);
export type CodexGoalAction = z.infer<typeof codexGoalActionSchema>;
export const userInputAnswersSchema = z.record(z.string(), z.array(z.string()));
export type UserInputAnswers = z.infer<typeof userInputAnswersSchema>;
