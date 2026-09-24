interface LinkedWorkspaceInput {
	id: string;
	hostId: string;
	externalWorkItemProvider?: string | null;
	externalWorkItemId?: string | null;
	externalWorkItemUrl?: string | null;
	lastActivityAt?: number | null;
	updatedAt: Date;
}

export interface SidebarUserStory {
	workItemId: number;
	url: string | null;
	/** Host that answers for the work item: the most recently active member's. */
	hostId: string;
	workspaceIds: string[];
}

function activityOf(workspace: LinkedWorkspaceInput): number {
	return workspace.lastActivityAt ?? workspace.updatedAt.getTime();
}

/** Azure-linked workspaces grouped by work item, most recently active first at both levels. */
export function buildDashboardSidebarUserStories(
	workspaces: readonly LinkedWorkspaceInput[],
): SidebarUserStory[] {
	const byWorkItem = new Map<string, LinkedWorkspaceInput[]>();
	for (const workspace of workspaces) {
		const id = workspace.externalWorkItemId;
		if (workspace.externalWorkItemProvider !== "azure-devops" || !id) continue;
		const members = byWorkItem.get(id) ?? [];
		members.push(workspace);
		byWorkItem.set(id, members);
	}
	return [...byWorkItem.entries()]
		.map(([id, members]) => {
			const sorted = [...members].sort((a, b) => activityOf(b) - activityOf(a));
			const latest = sorted[0] as LinkedWorkspaceInput;
			return {
				story: {
					workItemId: Number(id),
					url:
						sorted.find((m) => m.externalWorkItemUrl)?.externalWorkItemUrl ??
						null,
					hostId: latest.hostId,
					workspaceIds: sorted.map((m) => m.id),
				},
				activity: activityOf(latest),
			};
		})
		.sort((a, b) => b.activity - a.activity)
		.map(({ story }) => story);
}
