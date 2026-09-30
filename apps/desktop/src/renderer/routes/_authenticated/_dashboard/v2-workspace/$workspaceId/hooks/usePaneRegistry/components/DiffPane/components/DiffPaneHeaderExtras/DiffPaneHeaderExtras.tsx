import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceStore } from "@superset/panes";
import { TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { Eye, EyeOff, MessageSquare, MessageSquareOff } from "lucide-react";
import {
	PaneActionButton,
	PaneActionTooltip as Tooltip,
	usePaneActionDock,
} from "renderer/components/PaneActionButton";
import { useSettings } from "renderer/stores/settings";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../../../../../types";
import { DiffPanePRLink } from "./components/DiffPanePRLink";

interface DiffPaneHeaderExtrasProps {
	workspaceId: string;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}

// Unified/split moved into the in-pane DiffViewToolbar (shared with the PR
// Code tab); what stays here is workspace-specific: the PR link and the
// toggles that change what the diff shows rather than how it's laid out.
export function DiffPaneHeaderExtras({
	workspaceId,
	store,
}: DiffPaneHeaderExtrasProps) {
	const inDock = usePaneActionDock();
	const { t } = useLingui();
	const showDiffComments = useSettings((s) => s.showDiffComments);
	const expandUnchanged = useSettings((s) => s.expandUnchanged);
	const updateSetting = useSettings((s) => s.update);

	const buttonClass = (active: boolean) =>
		cn(
			"flex size-5 shrink-0 items-center justify-center transition-colors",
			active
				? "bg-secondary text-foreground"
				: "text-muted-foreground hover:text-foreground",
		);

	return (
		<div
			className={
				inDock ? "flex flex-col gap-0.5" : "flex shrink-0 items-center gap-1"
			}
		>
			<DiffPanePRLink workspaceId={workspaceId} store={store} />
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						onClick={() => updateSetting("showDiffComments", !showDiffComments)}
						aria-label={
							showDiffComments
								? t({
										message: "Hide PR review comments",
									})
								: t({
										message: "Show PR review comments",
									})
						}
						aria-pressed={showDiffComments}
						className={buttonClass(showDiffComments)}
						label={
							showDiffComments
								? t({
										message: "Hide PR review comments",
									})
								: t({
										message: "Show PR review comments",
									})
						}
						icon={
							showDiffComments ? (
								<MessageSquare className="size-3.5" />
							) : (
								<MessageSquareOff className="size-3.5" />
							)
						}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{showDiffComments ? (
						<Trans>Hide review comments</Trans>
					) : (
						<Trans>Show review comments</Trans>
					)}
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						onClick={() => updateSetting("expandUnchanged", !expandUnchanged)}
						aria-label={
							expandUnchanged
								? t({
										message: "Hide unchanged regions",
									})
								: t({
										message: "Show all lines",
									})
						}
						aria-pressed={expandUnchanged}
						className={buttonClass(expandUnchanged)}
						label={
							expandUnchanged
								? t({
										message: "Hide unchanged regions",
									})
								: t({
										message: "Show all lines",
									})
						}
						icon={
							expandUnchanged ? (
								<EyeOff className="size-3.5" />
							) : (
								<Eye className="size-3.5" />
							)
						}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{expandUnchanged ? (
						<Trans>Hide unchanged regions</Trans>
					) : (
						<Trans>Show all lines</Trans>
					)}
				</TooltipContent>
			</Tooltip>
			{!inDock && (
				<div
					className="mx-1 h-3.5 w-px shrink-0 bg-muted-foreground/30"
					aria-hidden="true"
				/>
			)}
		</div>
	);
}
