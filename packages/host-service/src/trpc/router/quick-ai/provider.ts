import {
	getAgyCliVersion,
	type QuickAiJsonSchema,
	type QuickAiModel,
	runAgyJson,
} from "./agy-cli";

export type QuickAiProviderId = "agy";

export interface QuickAiProvider {
	getVersion(): Promise<string | null>;
	runJson(
		model: QuickAiModel,
		instructions: string,
		context: string,
		jsonSchema: QuickAiJsonSchema,
	): Promise<unknown>;
}

const agyProvider: QuickAiProvider = {
	getVersion: getAgyCliVersion,
	runJson: runAgyJson,
};

export function getQuickAiProvider(
	provider: QuickAiProviderId,
): QuickAiProvider {
	switch (provider) {
		case "agy":
			return agyProvider;
	}
}
