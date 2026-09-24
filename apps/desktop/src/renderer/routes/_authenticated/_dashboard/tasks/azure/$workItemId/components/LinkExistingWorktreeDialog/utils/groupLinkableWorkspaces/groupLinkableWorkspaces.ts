export interface LinkableWorkspace {
	id: string;
	name: string;
	branch: string;
	projectId: string | null;
	externalWorkItemProvider?: string | null;
	externalWorkItemId?: string | null;
}

export interface LinkableWorkspaceGroup<T extends LinkableWorkspace> {
	projectId: string | null;
	projectName: string;
	workspaces: T[];
}

/** Workspaces not yet linked to `workItemId`, grouped by project and filtered by `query`. */
export function groupLinkableWorkspaces<T extends LinkableWorkspace>(
	workspaces: readonly T[],
	workItemId: string,
	query: string,
	projectName: (projectId: string | null) => string,
): LinkableWorkspaceGroup<T>[] {
	const needle = query.trim().toLowerCase();
	const groups = new Map<string | null, LinkableWorkspaceGroup<T>>();
	for (const workspace of workspaces) {
		if (
			workspace.externalWorkItemProvider === "azure-devops" &&
			workspace.externalWorkItemId === workItemId
		) {
			continue;
		}
		const name = projectName(workspace.projectId);
		if (
			needle &&
			![workspace.name, workspace.branch, name].some((value) =>
				value.toLowerCase().includes(needle),
			)
		) {
			continue;
		}
		let group = groups.get(workspace.projectId);
		if (!group) {
			group = {
				projectId: workspace.projectId,
				projectName: name,
				workspaces: [],
			};
			groups.set(workspace.projectId, group);
		}
		group.workspaces.push(workspace);
	}
	return [...groups.values()].sort((a, b) =>
		a.projectName.localeCompare(b.projectName),
	);
}
