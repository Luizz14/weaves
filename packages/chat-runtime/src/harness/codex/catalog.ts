import {
	type CodexExecution,
	type CodexModel,
	codexExecutionSchema,
	codexModelSchema,
} from "@superset/chat/protocol";
import { z } from "zod";
import { CodexRpcClient, spawnCodexTransport } from "./rpcClient";

export async function readCodexModels(
	client: CodexRpcClient,
): Promise<CodexModel[]> {
	const models: CodexModel[] = [];
	let cursor: string | null = null;
	do {
		const page = z
			.object({
				data: z.array(codexModelSchema),
				nextCursor: z.string().nullable(),
			})
			.parse(
				await client.request("model/list", { cursor, includeHidden: false }),
			);
		models.push(...page.data);
		cursor = page.nextCursor;
	} while (cursor);
	return models;
}
export function validateCodexExecution(
	value: CodexExecution,
	models: CodexModel[],
): CodexExecution {
	const execution = codexExecutionSchema.parse(value);
	const model = models.find((item) => item.model === execution.modelId);
	if (!model) throw new Error(`Codex model unavailable: ${execution.modelId}`);
	if (
		!model.supportedReasoningEfforts.some(
			(item) => item.reasoningEffort === execution.reasoningEffort,
		)
	)
		throw new Error(
			`Unsupported reasoning effort: ${execution.reasoningEffort}`,
		);
	if (
		execution.fast &&
		!model.serviceTiers.some((tier) => tier.id === "priority")
	)
		throw new Error("Fast is unavailable for this model");
	return execution;
}
let cached: { expires: number; models: CodexModel[] } | null = null;
let loading: Promise<CodexModel[]> | null = null;
export function listCodexModels(): Promise<CodexModel[]> {
	if (cached && cached.expires > Date.now())
		return Promise.resolve(cached.models);
	if (loading) return loading;
	loading = (async () => {
		const client = new CodexRpcClient({
			createTransport: (handlers) => spawnCodexTransport({}, handlers),
			onNotification: () => undefined,
			onServerRequest: (request) =>
				client.respondWithError(
					request.id,
					"Catalog discovery does not execute tools",
				),
		});
		const timeout = setTimeout(() => void client.close(), 30000);
		try {
			await client.initialize();
			const models = await readCodexModels(client);
			cached = { models, expires: Date.now() + 60000 };
			return models;
		} finally {
			clearTimeout(timeout);
			await client.close();
		}
	})().finally(() => {
		loading = null;
	});
	return loading;
}
