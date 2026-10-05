import type { BootstrapConfig, PostHog } from "posthog-js";

type FlagCache = Pick<
	PostHog["featureFlags"],
	"getFlagVariants" | "getFlagPayloads"
>;

export function getCachedPostHogBootstrap(client: {
	featureFlags: FlagCache;
}): BootstrapConfig {
	return {
		get featureFlags() {
			return client.featureFlags.getFlagVariants();
		},
		get featureFlagPayloads() {
			return client.featureFlags.getFlagPayloads();
		},
	};
}
