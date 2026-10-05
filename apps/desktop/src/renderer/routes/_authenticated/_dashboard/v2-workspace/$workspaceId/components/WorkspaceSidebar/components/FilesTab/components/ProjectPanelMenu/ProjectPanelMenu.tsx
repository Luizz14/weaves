import { Trans, useLingui } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

export function ProjectPanelMenu({
	newFile,
	newFolder,
	refresh,
	collapse,
	search,
}: {
	newFile: () => void;
	newFolder: () => void;
	refresh: () => void;
	collapse: () => void;
	search?: () => void;
}) {
	const { t } = useLingui();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover/project-panel:opacity-100 focus-visible:opacity-100"
					aria-label={t({ message: "Project actions" })}
				>
					<MoreHorizontal className="size-4" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="surface-outline border-none">
				<DropdownMenuItem onClick={newFile}>
					<Trans>New file</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={newFolder}>
					<Trans>New folder</Trans>
				</DropdownMenuItem>
				{search && (
					<DropdownMenuItem onClick={search}>
						<Trans>Search files</Trans>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={refresh}>
					<Trans>Refresh</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={collapse}>
					<Trans>Collapse all</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
