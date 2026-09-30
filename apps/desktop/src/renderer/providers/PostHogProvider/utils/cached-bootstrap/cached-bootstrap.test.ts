import { expect, test } from "bun:test";
import type { JsonType } from "posthog-js";
import { getCachedPostHogBootstrap } from "./cached-bootstrap";

test("cached bootstrap reads current flags and payloads without retaining a previous account snapshot", () => {
	let flags: Record<string, boolean | string> = { feature: true, variant: "b" };
	let payloads: Record<string, JsonType> = {
		feature: { limit: 3 },
		variant: ["a", "b"],
	};
	const bootstrap = getCachedPostHogBootstrap({
		featureFlags: {
			getFlagVariants: () => flags,
			getFlagPayloads: () => payloads,
		},
	});
	expect(bootstrap.featureFlags).toEqual(flags);
	expect(bootstrap.featureFlagPayloads).toEqual(payloads);
	flags = { feature: false };
	payloads = { feature: null };
	expect(bootstrap.featureFlags).toEqual({ feature: false });
	expect(bootstrap.featureFlagPayloads).toEqual({ feature: null });
	flags = {};
	payloads = {};
	expect(bootstrap.featureFlags).toEqual({});
	expect(bootstrap.featureFlagPayloads).toEqual({});
});
