import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { useCloudWorkspaces } from "renderer/hooks/useCloudWorkspaces";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useSandboxAccess } from "renderer/routes/_authenticated/providers/SandboxAccessProvider";
import { useLastActiveV2Workspace } from "renderer/stores/last-active-v2-workspace";
import { useRecentV2Workspaces } from "renderer/stores/recent-v2-workspaces";
import { useWorkspaceTransactionsStore } from "renderer/stores/workspace-creates";
import { CloudWorkspaceProvisioningState } from "../components/CloudWorkspaceProvisioningState";
import { StateScreenShell } from "../components/StateScreenShell";
import { WorkspaceCreateErrorState } from "../components/WorkspaceCreateErrorState";
import { WorkspaceCreatingState } from "../components/WorkspaceCreatingState";
import { WorkspaceHostIncompatibleState } from "../components/WorkspaceHostIncompatibleState";
import { WorkspaceNotFoundState } from "../components/WorkspaceNotFoundState";
import { useRemoteHostStatus } from "../hooks/useRemoteHostStatus";
import { useWorkspaceMissVerdict } from "../hooks/useWorkspaceMissVerdict";
import { WorkspaceProvider } from "../providers/WorkspaceProvider";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-workspace/$workspaceId",
)({
	component: V2WorkspaceLayout,
});

function V2WorkspaceLayout() {
	// Owned by this segment, so the param is available by definition. This used
	// to live on the parent route, which had to match its own child to recover
	// the id and then render an empty shell for the "no id" case that route
	// could always reach and this one cannot.
	const { workspaceId } = Route.useParams();
	const navigate = useNavigate();
	const collections = useCollections();
	const pendingOrganizationSwitch = useLastActiveV2Workspace(
		(state) => state.pendingOrganizationSwitch,
	);
	const recordWorkspace = useLastActiveV2Workspace(
		(state) => state.recordWorkspace,
	);
	const clearWorkspace = useLastActiveV2Workspace(
		(state) => state.clearWorkspace,
	);
	const { ensureWorkspaceInSidebar } = useDashboardSidebarState();
	const pendingTransaction = useWorkspaceTransactionsStore((state) =>
		workspaceId ? (state.byWorkspaceId[workspaceId] ?? null) : null,
	);
	// The create transaction clears when the workspaces.create mutation
	// settles — not when the host-served row first arrives, which happens
	// mid-create before agent/terminal panes are seeded.
	const isCreatePending = pendingTransaction?.type === "insert";

	const { toggleShowPresetsBar } = useV2UserPreferences();
	electronTrpc.menu.subscribe.useSubscription(undefined, {
		onData: (event) => {
			if (event.type === "toggle-presets-bar") {
				toggleShowPresetsBar();
			}
		},
	});

	const {
		workspaces: hostWorkspaces,
		isReady,
		hostsSettled,
		cache,
	} = useHostWorkspaces();
	const workspace = useMemo(
		() =>
			workspaceId != null
				? (hostWorkspaces.find((candidate) => candidate.id === workspaceId) ??
					null)
				: null,
		[hostWorkspaces, workspaceId],
	);
	// The open workspace's sandbox joins the fan-out as its own host, so a
	// cloud workspace is found the same way as any other — but it has no
	// v2_hosts row for the remote version gate to check.
	const { targets: sandboxes } = useSandboxAccess();
	const sandbox =
		sandboxes.find((candidate) => candidate.workspaceId === workspaceId) ??
		null;
	const isCloud = sandbox !== null;
	// The cloud row exists from the moment the workspace is created, which is
	// well before there is a sandbox to serve it.
	const { workspaces: cloudWorkspaces = [] } = useCloudWorkspaces();
	const cloudWorkspace =
		cloudWorkspaces.find((row) => row.id === workspaceId) ?? null;
	const { data: failedEntries } = useLiveQuery(
		(q) =>
			q
				.from({ failed: collections.failedWorkspaceCreates })
				.where(({ failed }) => eq(failed.id, workspaceId ?? "")),
		[collections, workspaceId],
	);
	const failedEntry = failedEntries?.[0] ?? null;

	const lastEnsuredWorkspaceIdRef = useRef<string | null>(null);
	useEffect(() => {
		if (!workspace || lastEnsuredWorkspaceIdRef.current === workspace.id)
			return;
		lastEnsuredWorkspaceIdRef.current = workspace.id;
		ensureWorkspaceInSidebar(workspace.id, workspace.projectId);
	}, [ensureWorkspaceInSidebar, workspace]);

	// Sandboxes ship with the app's own host-service build, so the remote
	// version gate has nothing to check and no host row to check it against.
	const hostStatus = useRemoteHostStatus(isCloud ? null : workspace);

	// "Not found" is a verdict, not a cache read: a CLI-created workspace can
	// trail its own deep link (missed broadcast, second host-service instance,
	// stale boot snapshot), so the route forces a refetch and waits for it —
	// bounded — before declaring the id missing.
	const missConfirmed = useWorkspaceMissVerdict(
		{
			workspaceId,
			workspaceFound: workspace !== null,
			suspended: pendingTransaction !== null || failedEntry !== null,
			hostsEnumerated: hostsSettled,
			hasLiveTargets: cache.hasLiveTargets,
			mirrorSettled: isReady,
		},
		cache.refetchAll,
	);
	const switchTargetsActiveOrganization =
		pendingOrganizationSwitch?.organizationId ===
		collections.activeOrganizationId;
	const switchTargetsCurrentWorkspace =
		switchTargetsActiveOrganization &&
		pendingOrganizationSwitch.targetWorkspaceId === workspaceId;
	const switchingAwayFromCurrentWorkspace =
		switchTargetsActiveOrganization &&
		!switchTargetsCurrentWorkspace &&
		!pendingOrganizationSwitch.hasReachedTarget;
	const workspaceExists = workspace !== null || cloudWorkspace !== null;
	const restoredWorkspaceMissing =
		switchTargetsCurrentWorkspace && !workspaceExists && missConfirmed;

	useEffect(() => {
		if (!workspaceExists || switchingAwayFromCurrentWorkspace) return;
		recordWorkspace(collections.activeOrganizationId, workspaceId);
	}, [
		collections.activeOrganizationId,
		recordWorkspace,
		switchingAwayFromCurrentWorkspace,
		workspaceExists,
		workspaceId,
	]);

	const recordRecentVisit = useRecentV2Workspaces((state) => state.recordVisit);
	const { projects } = useHostProjects();
	const projectName =
		projects.find((project) => project.id === workspace?.projectId)?.name ??
		null;
	useEffect(() => {
		if (!workspace || switchingAwayFromCurrentWorkspace) return;
		recordRecentVisit({
			workspaceId: workspace.id,
			organizationId: collections.activeOrganizationId,
			workspaceName: workspace.name,
			projectName,
			branch: workspace.branch,
			lastAccessedAt: Date.now(),
		});
	}, [
		collections.activeOrganizationId,
		projectName,
		recordRecentVisit,
		switchingAwayFromCurrentWorkspace,
		workspace,
	]);

	useEffect(() => {
		if (!restoredWorkspaceMissing) return;
		clearWorkspace(collections.activeOrganizationId, workspaceId);
		void navigate({ to: "/v2-workspaces", replace: true }).catch((error) => {
			console.error(
				"[organization-workspace-restore] Failed to open workspace list:",
				error,
			);
		});
	}, [
		clearWorkspace,
		collections.activeOrganizationId,
		navigate,
		restoredWorkspaceMissing,
		workspaceId,
	]);

	if (switchingAwayFromCurrentWorkspace || restoredWorkspaceMissing) {
		return <StateScreenShell>{null}</StateScreenShell>;
	}

	// Before "not found": a cloud workspace is navigated to as soon as its row
	// exists, so for the first seconds of its life there is nothing in the
	// fan-out to find. The same screen covers a ready sandbox that hasn't been
	// addressed yet (access minting, host-service booting) — that gap used to
	// be a blank frame, and letting it reach the host-unreachable takeover
	// would tell the user their machine is down while it is simply starting.
	if (!workspace && cloudWorkspace) {
		return (
			<StateScreenShell>
				<CloudWorkspaceProvisioningState
					workspaceId={cloudWorkspace.id}
					name={cloudWorkspace.name}
					branch={cloudWorkspace.branch}
					status={cloudWorkspace.status}
					createdAt={cloudWorkspace.createdAt}
				/>
			</StateScreenShell>
		);
	}

	if (!workspace) {
		if (failedEntry) {
			return (
				<StateScreenShell>
					<WorkspaceCreateErrorState entry={failedEntry} />
				</StateScreenShell>
			);
		}
		if (!missConfirmed) {
			return <StateScreenShell>{null}</StateScreenShell>;
		}
		return (
			<StateScreenShell>
				<WorkspaceNotFoundState workspaceId={workspaceId} />
			</StateScreenShell>
		);
	}

	if (isCreatePending) {
		return (
			<StateScreenShell>
				<WorkspaceCreatingState
					name={workspace.name}
					branch={workspace.branch}
					startedAt={new Date(workspace.createdAt).getTime()}
					isSession={workspace.type === "session"}
				/>
			</StateScreenShell>
		);
	}

	if (!isCloud) {
		if (hostStatus.status === "incompatible") {
			return (
				<StateScreenShell>
					<WorkspaceHostIncompatibleState
						hostId={hostStatus.hostId}
						hostUrl={hostStatus.hostUrl}
						hostName={hostStatus.hostName}
						hostVersion={hostStatus.hostVersion}
						minVersion={hostStatus.minVersion}
						installSource={hostStatus.installSource}
					/>
				</StateScreenShell>
			);
		}
		if (hostStatus.status === "loading") {
			return <StateScreenShell>{null}</StateScreenShell>;
		}
	}

	return (
		<WorkspaceProvider workspace={workspace}>
			<Outlet />
		</WorkspaceProvider>
	);
}
