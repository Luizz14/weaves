import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { buildDashboardSidebarUserStories } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/utils/buildDashboardSidebarUserStories";
import {
	applyWorkspaceChangedEvent,
	type HostWorkspaceRow,
} from "./useHostWorkspaces.utils";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const reactRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...reactRouter,
	useParams: () => ({}),
}));

let organizationId = "org-1";
const snapshots = new Map<string, HostWorkspaceRow[]>();
const emptyTargets: never[] = [];
mock.module("idb-keyval", () => ({
	get: async (key: string) => snapshots.get(key),
	set: async (key: string, value: HostWorkspaceRow[]) =>
		snapshots.set(key, value),
}));
mock.module("renderer/hooks/known-hosts/useKnownHosts", () => ({
	useKnownHosts: () => ({
		organizationId,
		settled: true,
		hosts: [{ organizationId, machineId: "remote", isOnline: false }],
	}),
}));
mock.module("renderer/hooks/useRelayUrl", () => ({
	useRelayUrl: () => "https://relay.example.com",
}));
mock.module("renderer/lib/auth-client", () => ({
	authClient: { useSession: () => ({ data: null }) },
}));
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: () => {
		throw new Error("offline hosts must not be queried");
	},
}));
mock.module("renderer/lib/host-event-bus", () => ({
	getHostEventBus: () => {
		throw new Error("offline hosts must not subscribe");
	},
}));
mock.module("renderer/lib/trpc-client", () => ({ electronTrpcClient: {} }));
mock.module(
	"renderer/routes/_authenticated/providers/LocalHostServiceProvider",
	() => ({
		useLocalHostService: () => ({ activeHostUrl: null, machineId: null }),
	}),
);
mock.module(
	"renderer/routes/_authenticated/providers/SandboxAccessProvider",
	() => ({
		useSandboxAccess: () => ({ targets: emptyTargets, isReady: true }),
	}),
);
const { useHostWorkspacesSource } = await import("./useHostWorkspaces");
let client: QueryClient;
beforeEach(() => {
	organizationId = "org-1";
	snapshots.clear();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
	cleanup();
	client.clear();
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

function seedSnapshot(org: string, workItemId: string) {
	const rows = applyWorkspaceChangedEvent(
		undefined,
		{
			eventType: "created",
			workspace: {
				id: `workspace-${org}`,
				projectId: "project-1",
				name: org,
				branch: org,
				type: "worktree",
				worktreePath: `/tmp/${org}`,
				taskId: null,
				createdByUserId: null,
				createdAt: 0,
				updatedAt: 10,
				lastActivityAt: 10,
				tags: [],
			},
		},
		{ organizationId: org, machineId: "remote" },
		`workspace-${org}`,
		null,
	);
	snapshots.set(
		`host-workspaces:v1:${org}:remote`,
		(rows ?? []).map((row) => ({
			...row,
			externalWorkItemProvider: "azure-devops",
			externalWorkItemId: workItemId,
			externalWorkItemUrl: `https://dev.azure.com/x/${workItemId}`,
		})),
	);
}

test.each([
	false,
	true,
])("org switching does not reuse another org's offline links (destination snapshot: %s)", async (hasDestinationSnapshot) => {
	seedSnapshot("org-1", "42");
	if (hasDestinationSnapshot) seedSnapshot("org-2", "7");
	const { result, rerender } = renderHook(() => useHostWorkspacesSource(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
	await waitFor(() => expect(result.current.workspaces).toHaveLength(1));
	expect(
		buildDashboardSidebarUserStories(result.current.workspaces)[0]?.workItemId,
	).toBe(42);
	await act(async () => {
		organizationId = "org-2";
		rerender();
	});
	expect(
		result.current.workspaces.every((row) => row.organizationId === "org-2"),
	).toBe(true);
	await waitFor(() => {
		expect(
			buildDashboardSidebarUserStories(result.current.workspaces).map(
				(story) => story.workItemId,
			),
		).toEqual(hasDestinationSnapshot ? [7] : []);
	});
	await act(async () => {
		organizationId = "org-1";
		rerender();
	});
	expect(
		buildDashboardSidebarUserStories(result.current.workspaces)[0]?.workItemId,
	).toBe(42);
});
