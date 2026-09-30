import { Plural, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { Eye } from "lucide-react";
import {
	PANE_DOCK_ACTION_CLASS_NAME,
	usePaneActionDock,
} from "renderer/components/PaneActionButton";
import { usePageWatchers } from "renderer/hooks/host-service/usePageWatchers";

interface TerminalPageWatchChipProps {
	compact?: boolean;
	workspaceId: string;
	terminalId: string;
}

export function TerminalPageWatchChip({
	compact = true,
	workspaceId,
	terminalId,
}: TerminalPageWatchChipProps) {
	const { t } = useLingui();
	const inDock = usePaneActionDock();
	const watchers = usePageWatchers(workspaceId);
	const mine = [...watchers.values()].filter(
		(watcher) => watcher.terminalId === terminalId,
	);

	if (mine.length === 0) return null;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					aria-label={t({
						message: "Pages this agent is watching for comments",
					})}
					className={cn(
						"h-5 items-center gap-1 rounded px-1 text-muted-foreground/70 text-xs",
						inDock
							? PANE_DOCK_ACTION_CLASS_NAME
							: compact
								? "hidden @min-[360px]/pane-header:flex"
								: "flex",
					)}
				>
					<Eye className={inDock ? "size-4 shrink-0" : "size-3"} />
					{inDock && (
						<span className="min-w-0 truncate">
							<Plural
								value={mine.length}
								one="Watching # page for comments"
								other="Watching # pages for comments"
							/>
						</span>
					)}
					{!inDock && mine.length > 1 ? <span>{mine.length}</span> : null}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="max-w-64">
				<div className="flex flex-col gap-1">
					<Plural
						value={mine.length}
						one="Watching # page for comments"
						other="Watching # pages for comments"
					/>
					<div className="flex flex-col gap-0.5 text-muted-foreground">
						{mine.map((watcher) => (
							<span key={watcher.pageId} className="truncate">
								{watcher.title}
							</span>
						))}
					</div>
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
