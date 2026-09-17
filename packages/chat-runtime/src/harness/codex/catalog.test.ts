import { expect, test } from "bun:test";
import type { CodexModel } from "@superset/chat/protocol";
import { validateCodexExecution } from "./catalog";

const model: CodexModel = {
	id: "model",
	model: "model",
	displayName: "Model",
	supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }],
	defaultReasoningEffort: "medium",
	serviceTiers: [],
};
const execution = {
	modelId: "model",
	reasoningEffort: "medium",
	collaborationMode: "default" as const,
	fast: false,
};
test("never silently substitutes unavailable models, efforts, or Fast", () => {
	expect(validateCodexExecution(execution, [model])).toEqual(execution);
	expect(() =>
		validateCodexExecution({ ...execution, modelId: "missing" }, [model]),
	).toThrow("unavailable");
	expect(() =>
		validateCodexExecution({ ...execution, reasoningEffort: "ultra" }, [model]),
	).toThrow("Unsupported");
	expect(() =>
		validateCodexExecution({ ...execution, fast: true }, [model]),
	).toThrow("Fast");
});
