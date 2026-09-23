import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback } from "react";
import { LuGitBranch } from "react-icons/lu";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { navigateToV2Workspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLastActiveV2Workspace } from "renderer/stores/last-active-v2-workspace";
import type { RecentV2Workspace } from "renderer/stores/recent-v2-workspaces";
import { useRecentWorkspaceSwitcher } from "./hooks/useRecentWorkspaceSwitcher";

export function RecentWorkspaceSwitcher() {
	const { t } = useLingui();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const reduceMotion = useReducedMotion();
	const { activeOrganizationId, switchOrganization } = useCollections();
	const { data: organizations } =
		cloudTrpc.organization.list.useQuery(undefined);

	const workspaceMatch = matchRoute({
		to: "/v2-workspace/$workspaceId",
		fuzzy: true,
	});
	const currentWorkspaceId =
		workspaceMatch === false ? null : workspaceMatch.workspaceId;

	const openWorkspace = useCallback(
		(entry: RecentV2Workspace) => {
			if (entry.workspaceId === currentWorkspaceId) return;
			if (entry.organizationId === activeOrganizationId) {
				void navigateToV2Workspace(entry.workspaceId, navigate);
				return;
			}
			useLastActiveV2Workspace
				.getState()
				.recordWorkspace(entry.organizationId, entry.workspaceId);
			void switchOrganization(entry.organizationId);
		},
		[activeOrganizationId, currentWorkspaceId, navigate, switchOrganization],
	);

	const { entries, selectedIndex, commitIndex } =
		useRecentWorkspaceSwitcher(openWorkspace);
	const organizationName = (organizationId: string) =>
		organizations?.find((organization) => organization.id === organizationId)
			?.name;

	return (
		<AnimatePresence>
			{selectedIndex !== null && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: reduceMotion ? 0 : 0.12 }}
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/30 px-4"
				>
					<motion.div
						role="listbox"
						aria-label={t({ message: "Recent workspaces" })}
						initial={{ scale: 0.97, y: 4 }}
						animate={{ scale: 1, y: 0 }}
						transition={
							reduceMotion
								? { duration: 0 }
								: { type: "spring", duration: 0.28, bounce: 0.06 }
						}
						className="flex max-h-[70vh] w-full max-w-md flex-col gap-0.5 overflow-y-auto rounded-3xl border-none bg-background p-2 shadow-[0_8px_32px_#1a1a1a14] surface-outline"
					>
						<div className="px-3 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
							<Trans>Recent workspaces</Trans>
						</div>
						{entries.length === 0 && (
							<div className="px-3 py-3 text-sm text-muted-foreground">
								<Trans>No recent workspaces yet</Trans>
							</div>
						)}
						{entries.map((entry, index) => {
							const selected = index === selectedIndex;
							const otherOrganization =
								entry.organizationId !== activeOrganizationId;
							return (
								<button
									key={entry.workspaceId}
									type="button"
									role="option"
									aria-selected={selected}
									ref={(node) => {
										if (selected) node?.scrollIntoView({ block: "nearest" });
									}}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => commitIndex(index)}
									className={cn(
										"relative flex w-full flex-col items-start gap-0.5 rounded-2xl py-2 pr-3 pl-4 text-left transition-colors",
										selected
											? "bg-primary/[0.06]"
											: "text-muted-foreground hover:bg-muted/60",
									)}
								>
									{selected && (
										<motion.span
											layoutId="recent-workspace-switcher-bar"
											transition={
												reduceMotion
													? { duration: 0 }
													: { type: "spring", duration: 0.28, bounce: 0.15 }
											}
											className="absolute top-2 bottom-2 left-1.5 w-[3px] rounded-full bg-primary"
										/>
									)}
									<span className="flex w-full items-center gap-2">
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-sm font-medium",
												selected && "text-foreground",
											)}
										>
											{entry.workspaceName}
										</span>
										{otherOrganization && (
											<span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
												{organizationName(entry.organizationId) ?? (
													<Trans>Other organization</Trans>
												)}
											</span>
										)}
									</span>
									<span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
										{entry.projectName && (
											<span className="truncate">{entry.projectName}</span>
										)}
										<LuGitBranch className="size-3 shrink-0" />
										<span className="truncate">{entry.branch}</span>
									</span>
								</button>
							);
						})}
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
