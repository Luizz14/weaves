import { describe, expect, mock, test } from "bun:test";
import { createAuthClient } from "better-auth/react";

const sessionBody = {
	user: { id: "user-1", onboardedAt: "2026-01-01T00:00:00.000Z" },
	session: {
		id: "session-1",
		expiresAt: "2099-01-01T00:00:00.000Z",
		activeOrganizationId: "org-1",
		organizationIds: ["org-1"],
	},
};

let respond: () => Response = () => Response.json(sessionBody);
const authClient = createAuthClient({
	baseURL: "http://auth.test",
	fetchOptions: {
		customFetchImpl: async () => respond(),
	},
});

const persisted: Array<{ token: string; snapshot: string | null }> = [];
mock.module("renderer/lib/auth-client", () => ({
	authClient,
	getAuthToken: () => "token-1",
}));
mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {
		auth: {
			persistSessionSnapshot: {
				mutate: async (input: { token: string; snapshot: string | null }) => {
					persisted.push(input);
					return { status: "saved" };
				},
			},
		},
	},
}));

const { startSessionSnapshotSync } = await import("./session-snapshot");

describe("startSessionSnapshotSync", () => {
	test("persists the answer when the anonymous mount fetch is still in flight", async () => {
		const anonymous = authClient.$store.atoms.session.get().refetch();

		startSessionSnapshotSync(null);
		const authenticated = authClient.$store.atoms.session.get().refetch();
		await Promise.all([anonymous, authenticated]);

		expect(persisted).toHaveLength(1);
	});

	test("persists what the server answers and clears it on 401", async () => {
		persisted.length = 0;
		startSessionSnapshotSync(null);
		await authClient.$store.atoms.session.get().refetch();

		expect(persisted).toHaveLength(1);
		expect(JSON.parse(persisted[0]?.snapshot ?? "null")).toMatchObject({
			session: { activeOrganizationId: "org-1" },
		});

		respond = () => Response.json({ message: "Unauthorized" }, { status: 401 });
		await authClient.$store.atoms.session.get().refetch();

		expect(persisted.at(-1)).toEqual({ token: "token-1", snapshot: null });
	});
});
