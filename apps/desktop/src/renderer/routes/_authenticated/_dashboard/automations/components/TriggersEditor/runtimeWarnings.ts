import type { DraftTrigger } from "@superset/shared/automation-triggers";
import { providerFor } from "../providers";
import type { ProviderOptions } from "../providers/types";

/** Deduplicated provider-level reasons a valid trigger may stay silent. */
export function collectRuntimeWarnings(
	drafts: DraftTrigger[],
	options: ProviderOptions,
): string[] {
	const seen = new Set<string>();
	for (const draft of drafts) {
		const provider = providerFor(draft.config);
		for (const warning of provider.runtimeWarnings?.(draft.config, options) ??
			[]) {
			seen.add(warning);
		}
	}
	return [...seen];
}
