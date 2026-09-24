import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useSidebarSectionsCollapseStore } from "renderer/stores/sidebar-sections-collapse";
import { buildDashboardSidebarUserStories } from "../../utils/buildDashboardSidebarUserStories";
import { DashboardSidebarSectionHeader } from "../DashboardSidebarSectionHeader";
import { SidebarRevealItem } from "../SidebarRevealItem";
import { SidebarRevealList } from "../SidebarRevealList";
import { DashboardSidebarUserStoryFolder } from "./components/DashboardSidebarUserStoryFolder";

interface DashboardSidebarUserStoriesSectionProps {
	onWorkspaceHover: (workspaceId: string) => void | Promise<void>;
}

/**
 * Azure DevOps work items with linked worktrees, one folder per item across
 * projects. Rows also stay in their project; these copies are not sortable,
 * since the same workspace id is already registered with the project's DnD.
 */
export function DashboardSidebarUserStoriesSection({
	onWorkspaceHover,
}: DashboardSidebarUserStoriesSectionProps) {
	const { t } = useLingui();
	const { workspaces } = useHostWorkspaces();
	const stories = useMemo(
		() => buildDashboardSidebarUserStories(workspaces),
		[workspaces],
	);
	const isSectionCollapsed = useSidebarSectionsCollapseStore(
		(s) => s.collapsed.userStories,
	);
	if (stories.length === 0) return null;

	return (
		<div className="mt-3 pb-1 first:mt-0">
			<DashboardSidebarSectionHeader
				label={t({ message: "User Stories" })}
				section="userStories"
			/>
			<SidebarRevealList open={!isSectionCollapsed}>
				{stories.map((story) => (
					<SidebarRevealItem key={story.workItemId}>
						<DashboardSidebarUserStoryFolder
							story={story}
							onWorkspaceHover={onWorkspaceHover}
						/>
					</SidebarRevealItem>
				))}
			</SidebarRevealList>
		</div>
	);
}
