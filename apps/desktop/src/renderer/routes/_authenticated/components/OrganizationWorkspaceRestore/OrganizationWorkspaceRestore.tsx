import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLastActiveV2Workspace } from "renderer/stores/last-active-v2-workspace";
import { syncPersistedStoreAcrossWindows } from "renderer/stores/syncPersistedStoreAcrossWindows";

export function OrganizationWorkspaceRestore() {
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const { activeOrganizationId } = useCollections();
	const { data: organizations } =
		cloudTrpc.organization.list.useQuery(undefined);
	const reconcileOrganizations = useLastActiveV2Workspace(
		(state) => state.reconcileOrganizations,
	);
	const pendingOrganizationSwitch = useLastActiveV2Workspace(
		(state) => state.pendingOrganizationSwitch,
	);
	const previousOrganizationIdRef = useRef(activeOrganizationId);
	const workspaceMatch = matchRoute({
		to: "/v2-workspace/$workspaceId",
		fuzzy: true,
	});
	const currentWorkspaceId =
		workspaceMatch === false ? null : workspaceMatch.workspaceId;

	useEffect(
		() => syncPersistedStoreAcrossWindows(useLastActiveV2Workspace),
		[],
	);

	useEffect(() => {
		if (!organizations) return;
		reconcileOrganizations(
			organizations.map((organization) => organization.id),
		);
	}, [organizations, reconcileOrganizations]);

	useEffect(() => {
		if (
			pendingOrganizationSwitch?.organizationId !== activeOrganizationId ||
			!pendingOrganizationSwitch.hasReachedTarget ||
			pendingOrganizationSwitch.targetWorkspaceId === currentWorkspaceId
		) {
			return;
		}
		useLastActiveV2Workspace
			.getState()
			.finishOrganizationSwitch(activeOrganizationId);
	}, [activeOrganizationId, currentWorkspaceId, pendingOrganizationSwitch]);

	useEffect(() => {
		if (previousOrganizationIdRef.current === activeOrganizationId) return;
		previousOrganizationIdRef.current = activeOrganizationId;

		const store = useLastActiveV2Workspace.getState();
		if (
			store.pendingOrganizationSwitch?.organizationId !== activeOrganizationId
		) {
			store.prepareOrganizationSwitch(activeOrganizationId);
		}
		const targetWorkspaceId =
			useLastActiveV2Workspace.getState().pendingOrganizationSwitch
				?.targetWorkspaceId ?? null;

		if (!targetWorkspaceId) {
			void navigate({ to: "/v2-workspaces", replace: true })
				.then(() => {
					useLastActiveV2Workspace
						.getState()
						.finishOrganizationSwitch(activeOrganizationId);
				})
				.catch((error) => {
					console.error(
						"[organization-workspace-restore] Failed to open workspace list:",
						error,
					);
				});
			return;
		}

		void navigate({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId: targetWorkspaceId },
			replace: true,
		}).catch((error) => {
			console.error(
				"[organization-workspace-restore] Failed to restore workspace:",
				error,
			);
			const currentStore = useLastActiveV2Workspace.getState();
			if (
				currentStore.pendingOrganizationSwitch?.organizationId !==
				activeOrganizationId
			) {
				return;
			}
			currentStore.finishOrganizationSwitch(activeOrganizationId);
			void navigate({ to: "/v2-workspaces", replace: true }).catch(
				(fallbackError) => {
					console.error(
						"[organization-workspace-restore] Failed to open workspace list:",
						fallbackError,
					);
				},
			);
		});
	}, [activeOrganizationId, navigate]);

	return null;
}
