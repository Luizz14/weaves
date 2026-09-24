import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LuChevronRight, LuSquareArrowOutUpRight } from "react-icons/lu";
import { useDashboardSidebarDnd } from "../../../../hooks/useSidebarDnd";
import type { SidebarUserStory } from "../../../../utils/buildDashboardSidebarUserStories";
import { DashboardSidebarWorkspaceItem } from "../../../DashboardSidebarWorkspaceItem";
import { SidebarRevealItem } from "../../../SidebarRevealItem";
import { SidebarRevealList } from "../../../SidebarRevealList";
import { useUserStoryTitle } from "./hooks/useUserStoryTitle";

interface DashboardSidebarUserStoryFolderProps {
	story: SidebarUserStory;
	onWorkspaceHover: (workspaceId: string) => void | Promise<void>;
}

export function DashboardSidebarUserStoryFolder({
	story,
	onWorkspaceHover,
}: DashboardSidebarUserStoryFolderProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const { workspacesById, projectsById } = useDashboardSidebarDnd();
	const [isOpen, setIsOpen] = useState(true);
	const title = useUserStoryTitle(story.workItemId, story.hostId);
	const workspaces = story.workspaceIds.flatMap((id) => {
		const workspace = workspacesById.get(id);
		return workspace ? [workspace] : [];
	});
	if (workspaces.length === 0) return null;

	const openWorkItem = () =>
		void navigate({
			to: "/tasks/azure/$workItemId",
			params: { workItemId: String(story.workItemId) },
			search: { type: "azure", azureHost: story.hostId },
		});

	return (
		<div className="pb-0.5">
			<div className="group/story flex h-8 items-center gap-1 rounded-md pr-1 pl-2 hover:bg-fill-hover">
				<button
					type="button"
					aria-expanded={isOpen}
					onClick={() => setIsOpen((open) => !open)}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<LuChevronRight
						className={cn(
							"size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
							isOpen && "rotate-90",
						)}
					/>
					<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
						#{story.workItemId}
					</span>
					<span className="min-w-0 flex-1 truncate text-[13px]">
						{title ?? t({ message: "User story" })}
					</span>
					<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
						{workspaces.length}
					</span>
				</button>
				<button
					type="button"
					onClick={openWorkItem}
					aria-label={t({ message: "Open work item" })}
					title={t({ message: "Open work item" })}
					className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/story:opacity-100"
				>
					<LuSquareArrowOutUpRight className="size-3.5" />
				</button>
			</div>
			<SidebarRevealList open={isOpen}>
				{workspaces.map((workspace) => {
					const project = workspace.projectId
						? projectsById.get(workspace.projectId)
						: null;
					return (
						<SidebarRevealItem key={workspace.id}>
							<DashboardSidebarWorkspaceItem
								workspace={workspace}
								indentation="workspace"
								isInSection
								pinnedContext={{
									projectName: project?.name ?? null,
									projectIconUrl: project?.iconUrl ?? null,
								}}
								onHoverCardOpen={onWorkspaceHover}
							/>
						</SidebarRevealItem>
					);
				})}
			</SidebarRevealList>
		</div>
	);
}
