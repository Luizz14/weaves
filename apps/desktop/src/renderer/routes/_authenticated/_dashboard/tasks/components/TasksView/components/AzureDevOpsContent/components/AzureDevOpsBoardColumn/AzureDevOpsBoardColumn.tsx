import { useDroppable } from "@dnd-kit/core";
import { Trans } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import type {
	AzureDevOpsBoardDisplayItem,
	AzureDevOpsBoardStage,
} from "../../types";
import { AzureDevOpsWorkItemCard } from "../AzureDevOpsWorkItemCard";

type AzureDevOpsBoardColumnProps = {
	stage: AzureDevOpsBoardStage;
	label: string;
	accentClass: string;
	items: AzureDevOpsBoardDisplayItem[];
	workspaceCountByItem: ReadonlyMap<number, number>;
	pullRequestCountByItem: ReadonlyMap<number, number>;
	onOpenItem: (item: AzureDevOpsBoardDisplayItem) => void;
};

export function AzureDevOpsBoardColumn({
	stage,
	label,
	accentClass,
	items,
	workspaceCountByItem,
	pullRequestCountByItem,
	onOpenItem,
}: AzureDevOpsBoardColumnProps) {
	const { isOver, setNodeRef } = useDroppable({
		id: `azure-stage-${stage}`,
		data: { stage },
		disabled: stage === "completed",
	});

	return (
		<section className="flex min-w-[18rem] flex-1 flex-col">
			<header className="mb-2 flex h-8 items-center justify-between px-1">
				<h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					{label}
				</h3>
				<span className="tabular-nums font-mono text-xs text-muted-foreground">
					{items.length}
				</span>
			</header>
			<div
				ref={setNodeRef}
				className={cn(
					"flex min-h-28 flex-1 flex-col gap-3 rounded-xl p-0.5 transition-[background-color,box-shadow] duration-150",
					isOver && "bg-muted/40 shadow-[inset_0_0_0_1px_var(--border)]",
				)}
			>
				{items.map((item) => (
					<AzureDevOpsWorkItemCard
						key={item.id}
						item={item}
						accentClass={accentClass}
						workspaceCount={workspaceCountByItem.get(item.id) ?? 0}
						pullRequestCount={pullRequestCountByItem.get(item.id) ?? 0}
						onOpen={() => onOpenItem(item)}
					/>
				))}
				{isOver ? (
					<div className="min-h-24 rounded-xl border border-dashed border-border bg-muted/20" />
				) : null}
				{items.length === 0 && !isOver ? (
					<div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
						<Trans>Drop a work item here</Trans>
					</div>
				) : null}
			</div>
		</section>
	);
}
