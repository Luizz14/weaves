import { Trans } from "@lingui/react/macro";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import { ChevronRight, ExternalLink } from "lucide-react";
import { AnimatedNumber } from "renderer/components/AnimatedNumber";
import { ZedFileIcon } from "renderer/lib/zedProjectPanel/components/ZedFileIcon";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import { PathActionsMenuItems } from "../../../ChangesFileList/components/PathActionsMenuItems";

export function LocalChangesDirectory({
	path,
	count,
	depth,
	open,
	onToggle,
	worktreePath,
	onOpenInEditor,
}: {
	path: string;
	count: number;
	depth: number;
	open: boolean;
	onToggle: () => void;
	worktreePath?: string;
	onOpenInEditor?: (path: string) => void;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<button
					type="button"
					data-change-navigation
					aria-expanded={open}
					onClick={onToggle}
					onKeyDown={(event) => {
						if (
							(event.key === "ArrowLeft" && open) ||
							(event.key === "ArrowRight" && !open)
						) {
							event.preventDefault();
							onToggle();
						}
					}}
					className="flex h-6 w-full items-center gap-2 pr-3 text-left text-muted-foreground hover:bg-accent/50 focus-visible:bg-accent/50"
					style={{ paddingLeft: 8 + depth * 20 }}
				>
					<ChevronRight
						className={cn("size-3 shrink-0", open && "rotate-90")}
					/>
					<ZedFileIcon
						fileName={path.split("/").at(-1) ?? path}
						folder={open ? "open" : "closed"}
					/>
					<span className="min-w-0 flex-1 truncate">
						{path.split("/").at(-1)}
					</span>
					<span className="text-xs tabular-nums">
						<AnimatedNumber value={count} />
					</span>
				</button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem
					onSelect={() => onOpenInEditor?.(path)}
					disabled={!onOpenInEditor}
				>
					<ExternalLink />
					<Trans>Open in Editor</Trans>
				</ContextMenuItem>
				{worktreePath && (
					<PathActionsMenuItems
						absolutePath={toAbsoluteWorkspacePath(worktreePath, path)}
						relativePath={path}
					/>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
