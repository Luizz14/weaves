import { useLingui } from "@lingui/react/macro";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@superset/ui/hover-card";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { computeChecksRollup } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/utils/computeChecksStatus";
import { PRIcon, type PRState } from "renderer/screens/main/components/PRIcon";
import type { PRFlowState } from "../../utils/getPRFlowState";
import { PRDetailCard } from "./components/PRDetailCard";
import { PRStatusIndicators } from "./components/PRStatusIndicators";

interface PRStatusGroupProps {
	state: PRFlowState;
	isChangesOpen: boolean;
	toggleLabel: string;
	onToggleChanges: () => void;
}

export function PRStatusGroup({
	state,
	isChangesOpen,
	toggleLabel,
	onToggleChanges,
}: PRStatusGroupProps) {
	const { t } = useLingui();
	const pr =
		state.kind === "pr-exists"
			? state.pr
			: state.kind === "busy" || state.kind === "error"
				? state.pr
				: null;
	const checks = useMemo(
		() => (pr ? computeChecksRollup(pr.checks) : null),
		[pr],
	);

	if (!pr || !checks) return null;

	const linkState = pr.isDraft
		? "draft"
		: pr.state === "merged"
			? "merged"
			: pr.state === "closed"
				? "closed"
				: pr.state === "queued"
					? "queued"
					: "open";
	const showIndicators = pr.state === "open" || pr.state === "queued";
	const tint = stateTintClasses(linkState);

	return (
		<div className={cn("flex items-center", tint.container)}>
			<HoverCard openDelay={150} closeDelay={120}>
				<HoverCardTrigger asChild>
					<button
						type="button"
						className={cn(
							"flex h-full items-center gap-1 px-1.5 outline-none transition-colors",
							tint.hover,
							isChangesOpen && tint.pressed,
						)}
						aria-pressed={isChangesOpen}
						aria-label={`${toggleLabel}, #${pr.number}`}
						onClick={onToggleChanges}
					>
						<PRIcon state={linkState} className="size-4" />
						<span
							className={cn(
								"font-mono text-xs",
								isChangesOpen ? "text-foreground" : "text-muted-foreground",
							)}
						>
							#{pr.number}
						</span>
						{showIndicators && <PRStatusIndicators checks={checks} />}
					</button>
				</HoverCardTrigger>
				<HoverCardContent
					align="end"
					sideOffset={8}
					className="w-80 overflow-hidden p-0"
				>
					<PRDetailCard pr={pr} checks={checks} linkState={linkState} />
				</HoverCardContent>
			</HoverCard>
		</div>
	);
}

function stateTintClasses(state: PRState): {
	container: string;
	hover: string;
	pressed: string;
} {
	switch (state) {
		case "open":
			return {
				container: "bg-emerald-500/10",
				hover: "hover:bg-emerald-500/15 focus-visible:bg-emerald-500/15",
				pressed: "bg-emerald-500/20",
			};
		case "merged":
			return {
				container: "bg-violet-500/10",
				hover: "hover:bg-violet-500/15 focus-visible:bg-violet-500/15",
				pressed: "bg-violet-500/20",
			};
		case "closed":
			return {
				container: "bg-rose-500/10",
				hover: "hover:bg-rose-500/15 focus-visible:bg-rose-500/15",
				pressed: "bg-rose-500/20",
			};
		case "draft":
			return {
				container: "bg-muted/40",
				hover: "hover:bg-muted/60 focus-visible:bg-muted/60",
				pressed: "bg-muted/70",
			};
		case "queued":
			return {
				container: "bg-amber-500/10",
				hover: "hover:bg-amber-500/15 focus-visible:bg-amber-500/15",
				pressed: "bg-amber-500/20",
			};
	}
}
