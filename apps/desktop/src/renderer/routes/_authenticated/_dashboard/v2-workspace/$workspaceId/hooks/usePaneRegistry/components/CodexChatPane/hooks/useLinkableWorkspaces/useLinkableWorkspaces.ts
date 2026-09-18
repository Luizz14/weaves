import { useMemo } from "react";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import type { LinkableWorkspace } from "../../components/LinkWorkspacesDialog";

/**
 * The workspaces a chat can link: the chat's own host only, because the host
 * is what resolves a workspace id to a path the agent can reach.
 */
export function useLinkableWorkspaces(currentWorkspaceId: string): {
	workspaces: LinkableWorkspace[];
	isLoading: boolean;
} {
	const { workspaces, isReady } = useHostWorkspaces();
	const { projects, isReady: projectsReady } = useHostProjects();

	return useMemo(() => {
		const current = workspaces.find((entry) => entry.id === currentWorkspaceId);
		const projectNames = new Map(
			projects.map((project) => [project.id, project.name]),
		);
		const linkable = workspaces
			.filter(
				(entry) =>
					entry.id !== currentWorkspaceId &&
					entry.archivedAt == null &&
					(current ? entry.hostId === current.hostId : true),
			)
			.map((entry) => ({
				id: entry.id,
				name: entry.name,
				branch: entry.branch,
				projectId: entry.projectId,
				projectName: entry.projectId
					? (projectNames.get(entry.projectId) ?? entry.name)
					: entry.name,
				lastActivityAt: entry.lastActivityAt ?? 0,
			}))
			.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
			.map(({ lastActivityAt: _lastActivityAt, ...entry }) => entry);

		return {
			workspaces: linkable,
			isLoading: linkable.length === 0 && !(isReady && projectsReady),
		};
	}, [workspaces, projects, currentWorkspaceId, isReady, projectsReady]);
}
