import {
	type PlanTier,
	planTierFromSubscription,
} from "@superset/shared/billing";
import type { RouterOutputs } from "@superset/trpc";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { useActiveOrganizationId } from "./useActiveOrganizationId";

type ActivePlan = RouterOutputs["billing"]["activePlan"];

/**
 * The plan of the organization THIS window shows.
 *
 * Only the billing query answers that: the window's organization header scopes
 * it server-side. The login session carries a plan too, but for the session's
 * organization, which is shared by every window and follows whichever one
 * switched last — so it is never consulted here.
 *
 * The query is keyed without the organization, so for one render after a
 * switch the cache still holds the previous organization's answer. Every read
 * checks whose plan it is holding.
 */
export function useCurrentPlan() {
	const organizationId = useActiveOrganizationId();
	const { data } = cloudTrpc.billing.activePlan.useQuery(undefined);

	const activePlan = isPlanFor(data, organizationId) ? data : undefined;
	const isReady = activePlan !== undefined;
	const plan: PlanTier = activePlan
		? planTierFromSubscription(activePlan)
		: "free";

	return { plan, isReady, activePlan };
}

function isPlanFor(
	activePlan: ActivePlan | undefined,
	organizationId: string | null,
): activePlan is ActivePlan {
	return (
		activePlan !== undefined &&
		organizationId !== null &&
		activePlan.organizationId === organizationId
	);
}
