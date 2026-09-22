import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Trans } from "@lingui/react/macro";
import { Badge } from "@superset/ui/badge";
import { cn } from "@superset/ui/utils";
import { LuGitBranch, LuGitPullRequest } from "react-icons/lu";
import type { AzureDevOpsBoardDisplayItem } from "../../types";

type AzureDevOpsWorkItemCardProps = {
	item: AzureDevOpsBoardDisplayItem;
	accentClass: string;
	workspaceCount: number;
	pullRequestCount: number;
	onOpen: () => void;
	overlay?: boolean;
};

export function AzureDevOpsWorkItemCard({
	item,
	accentClass,
	workspaceCount,
	pullRequestCount,
	onOpen,
	overlay = false,
}: AzureDevOpsWorkItemCardProps) {
	const isReadOnly = Boolean(item.claim && !item.claim.isCurrentUser);
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({
			id: `azure-work-item-${item.id}`,
			data: { item },
			disabled: overlay || isReadOnly || item.stage === "completed",
		});
	const style = transform
		? { transform: CSS.Translate.toString(transform) }
		: undefined;

	return (
		// biome-ignore lint/a11y/useSemanticElements: dnd-kit draggable attributes require a non-button container
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			role="button"
			tabIndex={0}
			aria-disabled={isReadOnly || item.stage === "completed"}
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				onOpen();
			}}
			className={cn(
				"group relative cursor-grab rounded-xl bg-card px-3 py-3 text-left shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_-1px_rgb(0_0_0/0.08),0_4px_12px_rgb(0_0_0/0.04)] outline-none transition-[box-shadow,opacity,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]",
				"hover:shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_2px_4px_-1px_rgb(0_0_0/0.1),0_8px_20px_rgb(0_0_0/0.06)] dark:hover:shadow-[0_0_0_1px_rgb(255_255_255/0.13)]",
				isDragging && !overlay && "opacity-0",
				overlay && "cursor-grabbing shadow-2xl",
				isReadOnly && "cursor-default opacity-70",
			)}
		>
			<div
				className={cn(
					"absolute inset-y-4 left-3 w-0.5 rounded-full",
					accentClass,
				)}
			/>
			<div className="min-w-0 pl-3">
				<div className="flex items-center justify-between gap-2">
					<span className="font-mono text-xs text-muted-foreground">
						AB#{item.id}
					</span>
					{item.storyPoints !== null ? (
						<span className="tabular-nums text-xs text-muted-foreground">
							{item.storyPoints}
						</span>
					) : null}
				</div>
				<p className="mt-2 line-clamp-3 text-pretty text-sm font-medium leading-snug">
					{item.title}
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-1.5">
					{item.tags.slice(0, 2).map((tag) => (
						<Badge
							key={tag}
							variant="secondary"
							className="h-5 rounded-full px-2 font-mono text-[10px] font-normal"
						>
							{tag}
						</Badge>
					))}
					{workspaceCount > 0 ? (
						<Badge
							variant="outline"
							className="h-5 rounded-full px-2 font-mono text-[10px] font-normal"
						>
							<LuGitBranch className="size-3" />
							{workspaceCount}
						</Badge>
					) : null}
					{pullRequestCount > 0 ? (
						<Badge
							variant="outline"
							className="h-5 rounded-full px-2 font-mono text-[10px] font-normal"
						>
							<LuGitPullRequest className="size-3" />
							{pullRequestCount}
						</Badge>
					) : null}
				</div>
				{isReadOnly ? (
					<p className="mt-2 truncate text-xs text-muted-foreground">
						{item.claim?.assignedTo?.displayName ?? (
							<Trans>Claimed in Azure DevOps</Trans>
						)}
					</p>
				) : null}
			</div>
		</div>
	);
}
