import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { GitCompareArrows } from "lucide-react";
import { memo, useMemo } from "react";
import { AnimatedNumber } from "renderer/components/AnimatedNumber";
import { useWorkspaceGitStatus } from "../../providers/WorkspaceGitStatusProvider";
import { changesPillStats } from "./changesPillStats";
import { PRStatusGroup } from "./components/PRStatusGroup";
import { usePRFlowState } from "./hooks/usePRFlowState";

interface ChangesControlProps {
	workspaceId: string;
	/** Whether the active tab shows a Changes pane — the face's toggle state. */
	isChangesOpen: boolean;
	/** Close the visible Changes pane, or open/focus one when none shows. */
	onToggleChanges: () => void;
}

/** The top-bar diff count and PR status remain available outside the action dock. */
export const ChangesControl = memo(function ChangesControl({
	workspaceId,
	isChangesOpen,
	onToggleChanges,
}: ChangesControlProps) {
	const { t } = useLingui();
	const status = useWorkspaceGitStatus();
	const { flowState } = usePRFlowState(workspaceId);
	const stats = useMemo(
		() => (status.data ? changesPillStats(status.data) : null),
		[status.data],
	);

	const label = isChangesOpen
		? t({
				message: "Close changes",
			})
		: t({
				message: "Open changes",
			});

	const hasPr =
		flowState.kind === "pr-exists" ||
		((flowState.kind === "busy" || flowState.kind === "error") &&
			flowState.pr != null);
	const visibleStats =
		!hasPr && stats != null && stats.fileCount > 0 ? stats : null;

	return (
		<div className="flex h-7 items-stretch overflow-hidden rounded-md border border-border/60 bg-muted/30 empty:hidden">
			{visibleStats && (
				<button
					type="button"
					onClick={onToggleChanges}
					aria-label={label}
					aria-pressed={isChangesOpen}
					title={label}
					className={cn(
						"flex items-center gap-1 px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground",
						isChangesOpen && "bg-accent/60 text-foreground",
					)}
				>
					<GitCompareArrows className="size-3.5" />
					{visibleStats.additions > 0 && (
						<span className="tabular-nums text-emerald-600 [.dark_&]:text-[#34d399]">
							+<AnimatedNumber value={visibleStats.additions} />
						</span>
					)}
					{visibleStats.deletions > 0 && (
						<span className="tabular-nums text-red-600 [.dark_&]:text-[#f87171]">
							−<AnimatedNumber value={visibleStats.deletions} />
						</span>
					)}
					{visibleStats.additions === 0 && visibleStats.deletions === 0 && (
						<span className="tabular-nums">
							<AnimatedNumber value={visibleStats.fileCount} />
						</span>
					)}
				</button>
			)}
			{flowState.kind !== "no-pr" && (
				<PRStatusGroup
					state={flowState}
					isChangesOpen={isChangesOpen}
					toggleLabel={label}
					onToggleChanges={onToggleChanges}
				/>
			)}
		</div>
	);
});
