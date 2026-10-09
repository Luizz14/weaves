import { describe, expect, test } from "bun:test";
import { parseSessionSnapshot } from "./parse-session-snapshot";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");

function snapshot(
	overrides: {
		user?: Record<string, unknown>;
		session?: Record<string, unknown>;
	} = {},
): string {
	return JSON.stringify({
		user: {
			id: "user-1",
			onboardedAt: "2026-01-01T00:00:00.000Z",
			deletionRequestedAt: null,
			...overrides.user,
		},
		session: {
			id: "session-1",
			expiresAt: "2026-11-01T00:00:00.000Z",
			activeOrganizationId: "org-1",
			organizationIds: ["org-1", "org-2"],
			...overrides.session,
		},
	});
}

describe("parseSessionSnapshot", () => {
	test("revives ISO timestamps as dates, like the auth client does", () => {
		const data = parseSessionSnapshot(snapshot(), NOW);

		expect(data?.user.onboardedAt).toBeInstanceOf(Date);
		expect(data?.session.expiresAt).toEqual(
			new Date("2026-11-01T00:00:00.000Z"),
		);
		expect(data?.session.activeOrganizationId).toBe("org-1");
	});

	test("rejects snapshots whose confirmed session would redirect", () => {
		expect(
			parseSessionSnapshot(snapshot({ user: { onboardedAt: null } }), NOW),
		).toBeNull();
		expect(
			parseSessionSnapshot(
				snapshot({ user: { deletionRequestedAt: "2026-10-01T00:00:00.000Z" } }),
				NOW,
			),
		).toBeNull();
		expect(
			parseSessionSnapshot(
				snapshot({ session: { activeOrganizationId: null } }),
				NOW,
			),
		).toBeNull();
		expect(
			parseSessionSnapshot(
				snapshot({ session: { activeOrganizationId: "org-3" } }),
				NOW,
			),
		).toBeNull();
	});

	test("rejects expired, malformed and missing snapshots", () => {
		expect(
			parseSessionSnapshot(
				snapshot({ session: { expiresAt: "2026-10-01T00:00:00.000Z" } }),
				NOW,
			),
		).toBeNull();
		expect(parseSessionSnapshot("{not json", NOW)).toBeNull();
		expect(parseSessionSnapshot("null", NOW)).toBeNull();
		expect(parseSessionSnapshot(null, NOW)).toBeNull();
	});
});
