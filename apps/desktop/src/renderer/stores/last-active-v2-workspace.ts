import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

type PendingOrganizationSwitch = {
	organizationId: string;
	targetWorkspaceId: string | null;
	hasReachedTarget: boolean;
};

type PersistedLastActiveV2WorkspaceState = {
	workspaceIdsByOrganizationId: Record<string, string>;
};

type LastActiveV2WorkspaceState = PersistedLastActiveV2WorkspaceState & {
	pendingOrganizationSwitch: PendingOrganizationSwitch | null;
	recordWorkspace: (organizationId: string, workspaceId: string) => void;
	clearWorkspace: (organizationId: string, workspaceId: string) => void;
	prepareOrganizationSwitch: (organizationId: string) => void;
	finishOrganizationSwitch: (organizationId: string) => void;
	reconcileOrganizations: (organizationIds: readonly string[]) => void;
};

export function migrateLastActiveV2WorkspaceState(
	persistedState: unknown,
	fromVersion: number,
): PersistedLastActiveV2WorkspaceState {
	if (fromVersion < 2) {
		return { workspaceIdsByOrganizationId: {} };
	}
	if (!persistedState || typeof persistedState !== "object") {
		return { workspaceIdsByOrganizationId: {} };
	}
	const persistedWorkspaceIds = (
		persistedState as { workspaceIdsByOrganizationId?: unknown }
	).workspaceIdsByOrganizationId;
	if (!persistedWorkspaceIds || typeof persistedWorkspaceIds !== "object") {
		return { workspaceIdsByOrganizationId: {} };
	}
	const workspaceIdsByOrganizationId = Object.fromEntries(
		Object.entries(persistedWorkspaceIds).filter(
			(entry): entry is [string, string] =>
				entry[0].length > 0 &&
				typeof entry[1] === "string" &&
				entry[1].length > 0,
		),
	);
	return { workspaceIdsByOrganizationId };
}

export const useLastActiveV2Workspace = create<LastActiveV2WorkspaceState>()(
	devtools(
		persist(
			(set, get) => ({
				workspaceIdsByOrganizationId: {},
				pendingOrganizationSwitch: null,
				recordWorkspace: (organizationId, workspaceId) =>
					set((state) => {
						const pendingForOrganization =
							state.pendingOrganizationSwitch?.organizationId === organizationId
								? state.pendingOrganizationSwitch
								: null;
						const reachesSwitchTarget =
							pendingForOrganization?.targetWorkspaceId === workspaceId;
						const leavesReachedSwitchTarget =
							pendingForOrganization?.hasReachedTarget === true &&
							!reachesSwitchTarget;
						if (
							state.workspaceIdsByOrganizationId[organizationId] ===
								workspaceId &&
							!reachesSwitchTarget &&
							!leavesReachedSwitchTarget
						) {
							return state;
						}
						return {
							workspaceIdsByOrganizationId: {
								...state.workspaceIdsByOrganizationId,
								[organizationId]: workspaceId,
							},
							pendingOrganizationSwitch: leavesReachedSwitchTarget
								? null
								: reachesSwitchTarget && pendingForOrganization
									? { ...pendingForOrganization, hasReachedTarget: true }
									: state.pendingOrganizationSwitch,
						};
					}),
				clearWorkspace: (organizationId, workspaceId) =>
					set((state) => {
						if (
							state.workspaceIdsByOrganizationId[organizationId] !== workspaceId
						) {
							return {
								pendingOrganizationSwitch:
									state.pendingOrganizationSwitch?.organizationId ===
									organizationId
										? null
										: state.pendingOrganizationSwitch,
							};
						}
						const next = { ...state.workspaceIdsByOrganizationId };
						delete next[organizationId];
						return {
							workspaceIdsByOrganizationId: next,
							pendingOrganizationSwitch:
								state.pendingOrganizationSwitch?.organizationId ===
								organizationId
									? null
									: state.pendingOrganizationSwitch,
						};
					}),
				prepareOrganizationSwitch: (organizationId) =>
					set({
						pendingOrganizationSwitch: {
							organizationId,
							targetWorkspaceId:
								get().workspaceIdsByOrganizationId[organizationId] ?? null,
							hasReachedTarget: false,
						},
					}),
				finishOrganizationSwitch: (organizationId) =>
					set((state) => ({
						pendingOrganizationSwitch:
							state.pendingOrganizationSwitch?.organizationId === organizationId
								? null
								: state.pendingOrganizationSwitch,
					})),
				reconcileOrganizations: (organizationIds) =>
					set((state) => {
						const allowed = new Set(organizationIds);
						const entries = Object.entries(state.workspaceIdsByOrganizationId);
						const retainedEntries = entries.filter(([organizationId]) =>
							allowed.has(organizationId),
						);
						const pendingOrganizationSwitch =
							state.pendingOrganizationSwitch &&
							allowed.has(state.pendingOrganizationSwitch.organizationId)
								? state.pendingOrganizationSwitch
								: null;
						if (
							retainedEntries.length === entries.length &&
							pendingOrganizationSwitch === state.pendingOrganizationSwitch
						) {
							return state;
						}
						const workspaceIdsByOrganizationId =
							Object.fromEntries(retainedEntries);
						return {
							workspaceIdsByOrganizationId,
							pendingOrganizationSwitch,
						};
					}),
			}),
			{
				name: "last-active-v2-workspace",
				version: 2,
				migrate: migrateLastActiveV2WorkspaceState,
				partialize: (state) => ({
					workspaceIdsByOrganizationId: state.workspaceIdsByOrganizationId,
				}),
			},
		),
	),
);
