import type { authClient } from "renderer/lib/auth-client";

export type SessionData = NonNullable<
	ReturnType<typeof authClient.useSession>["data"]
>;

const ISO_DATE =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;

function reviveDates(_key: string, value: unknown): unknown {
	if (typeof value !== "string" || !ISO_DATE.test(value)) return value;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date;
}

/**
 * The snapshot only stands in for the server when it leads to the same screen
 * the server's answer would: any state that redirects (sign-in, onboarding,
 * pending deletion, create-organization) must come from a confirmed session.
 */
export function parseSessionSnapshot(
	json: string | null | undefined,
	now = Date.now(),
): SessionData | null {
	if (!json) return null;
	let data: SessionData;
	try {
		data = JSON.parse(json, reviveDates) as SessionData;
	} catch {
		return null;
	}
	const session = data?.session;
	const user = data?.user;
	if (!session || !user) return null;
	if (!user.onboardedAt || user.deletionRequestedAt) return null;
	const activeOrganizationId = session.activeOrganizationId;
	if (
		!activeOrganizationId ||
		!session.organizationIds?.includes(activeOrganizationId)
	) {
		return null;
	}
	const expiresAt = new Date(session.expiresAt).getTime();
	if (!(expiresAt > now)) return null;
	return data;
}
