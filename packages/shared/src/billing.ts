export const PLAN_TIERS = ["free", "pro", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/**
 * Subscription.status values considered "paying" for gating purposes.
 *
 * `past_due` counts. Stripe retries a failed payment for ~14 days before giving
 * up, and duplicating that window here would mean two sources of truth that
 * drift the moment anyone edits the retry schedule in the dashboard. When Stripe
 * does give up it cancels the subscription, `customer.subscription.deleted`
 * lands, and the row moves to `canceled` — dropping out of this list on its own.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = [
	"active",
	"trialing",
	"past_due",
] as const;
export type ActiveSubscriptionStatus =
	(typeof ACTIVE_SUBSCRIPTION_STATUSES)[number];

export function isPaidPlan(plan: string | null | undefined): boolean {
	return plan != null && plan !== "free";
}

export function isActiveSubscriptionStatus(
	status: string | null | undefined,
): status is ActiveSubscriptionStatus {
	return ACTIVE_SUBSCRIPTION_STATUSES.some((candidate) => candidate === status);
}

/**
 * Access continues, but collection is failing and the subscription will be
 * canceled if it keeps failing. Surface this — never gate on it.
 */
export function isPaymentFailingStatus(
	status: string | null | undefined,
): boolean {
	return status === "past_due";
}

export function isPaidPlanTier(
	plan: string | null | undefined,
): plan is "pro" | "enterprise" {
	return plan === "pro" || plan === "enterprise";
}

/**
 * The tier to render right now. The subscription row wins over the session
 * (which can lag a checkout), but an unresolved query must not read as free —
 * that would show a live Upgrade to an organization that may already pay —
 * so the session plan fills in until it arrives.
 */
export function resolveCurrentPlan({
	subscriptionPlan,
	sessionPlan,
	subscriptionsLoaded,
}: {
	subscriptionPlan?: string | null;
	sessionPlan?: string | null;
	subscriptionsLoaded: boolean;
}): PlanTier {
	if (isPaidPlanTier(subscriptionPlan)) return subscriptionPlan;
	if (subscriptionsLoaded) return "free";
	if (isPaidPlanTier(sessionPlan)) return sessionPlan;
	return "free";
}

/**
 * The plan tier a subscription row resolves to: its plan while the
 * subscription is still paying, `free` otherwise (or when there is no row).
 */
export function planTierFromSubscription(
	subscription:
		| { plan: string | null | undefined; status: string | null | undefined }
		| null
		| undefined,
): PlanTier {
	if (!subscription || !isActiveSubscriptionStatus(subscription.status)) {
		return "free";
	}
	const plan = subscription.plan;
	return plan === "pro" || plan === "enterprise" ? plan : "free";
}
