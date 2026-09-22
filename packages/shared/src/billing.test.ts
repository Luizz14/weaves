import { describe, expect, test } from "bun:test";
import { planTierFromSubscription, resolveCurrentPlan } from "./billing";

describe("planTierFromSubscription", () => {
	test("no subscription is free", () => {
		expect(planTierFromSubscription(null)).toBe("free");
		expect(planTierFromSubscription(undefined)).toBe("free");
	});

	test("a paying subscription resolves to its plan", () => {
		expect(planTierFromSubscription({ plan: "pro", status: "active" })).toBe(
			"pro",
		);
		expect(
			planTierFromSubscription({ plan: "enterprise", status: "trialing" }),
		).toBe("enterprise");
		// Stripe is still retrying; access continues through its dunning window.
		expect(planTierFromSubscription({ plan: "pro", status: "past_due" })).toBe(
			"pro",
		);
	});

	test("a lapsed subscription is free again", () => {
		expect(planTierFromSubscription({ plan: "pro", status: "canceled" })).toBe(
			"free",
		);
		expect(planTierFromSubscription({ plan: "free", status: "active" })).toBe(
			"free",
		);
	});
});

describe("resolveCurrentPlan", () => {
	test("prefers the live subscription plan over a stale session plan", () => {
		expect(
			resolveCurrentPlan({
				subscriptionPlan: "pro",
				sessionPlan: "free",
				subscriptionsLoaded: true,
			}),
		).toBe("pro");
	});

	test("treats loaded subscriptions with no active plan as free", () => {
		expect(
			resolveCurrentPlan({
				subscriptionPlan: null,
				sessionPlan: "pro",
				subscriptionsLoaded: true,
			}),
		).toBe("free");
	});

	test("falls back to the session plan while subscriptions are still loading", () => {
		expect(
			resolveCurrentPlan({
				subscriptionPlan: null,
				sessionPlan: "pro",
				subscriptionsLoaded: false,
			}),
		).toBe("pro");
	});

	test("supports enterprise subscriptions", () => {
		expect(
			resolveCurrentPlan({
				subscriptionPlan: "enterprise",
				sessionPlan: "free",
				subscriptionsLoaded: true,
			}),
		).toBe("enterprise");
	});
});
