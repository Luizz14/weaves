import { create } from "zustand";
import { persist } from "zustand/middleware";

export const RECENT_V2_WORKSPACES_LIMIT = 20;

export interface RecentV2Workspace {
	workspaceId: string;
	organizationId: string;
	workspaceName: string;
	projectName: string | null;
	branch: string;
	lastAccessedAt: number;
}

interface RecentV2WorkspacesState {
	entries: RecentV2Workspace[];
	recordVisit: (entry: RecentV2Workspace) => void;
	remove: (workspaceId: string) => void;
	reconcileOrganizations: (organizationIds: readonly string[]) => void;
}

function isSameEntry(a: RecentV2Workspace, b: RecentV2Workspace): boolean {
	return (
		a.workspaceId === b.workspaceId &&
		a.organizationId === b.organizationId &&
		a.workspaceName === b.workspaceName &&
		a.projectName === b.projectName &&
		a.branch === b.branch
	);
}

export const useRecentV2Workspaces = create<RecentV2WorkspacesState>()(
	persist(
		(set) => ({
			entries: [],
			recordVisit: (entry) =>
				set((state) => {
					const first = state.entries[0];
					if (first && isSameEntry(first, entry)) return state;
					return {
						entries: [
							entry,
							...state.entries.filter(
								(candidate) => candidate.workspaceId !== entry.workspaceId,
							),
						].slice(0, RECENT_V2_WORKSPACES_LIMIT),
					};
				}),
			remove: (workspaceId) =>
				set((state) => ({
					entries: state.entries.filter(
						(entry) => entry.workspaceId !== workspaceId,
					),
				})),
			reconcileOrganizations: (organizationIds) =>
				set((state) => {
					const allowed = new Set(organizationIds);
					const entries = state.entries.filter((entry) =>
						allowed.has(entry.organizationId),
					);
					return entries.length === state.entries.length ? state : { entries };
				}),
		}),
		{
			name: "recent-v2-workspaces",
			version: 1,
			partialize: (state) => ({ entries: state.entries }),
		},
	),
);
