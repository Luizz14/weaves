import {
	closestCorners,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AZURE_BOARD_STAGES, canMoveAzureBoardItem } from "../../constants";
import type {
	AzureDevOpsBoardDisplayItem,
	AzureDevOpsBoardStage,
} from "../../types";
import { AzureDevOpsBoardColumn } from "../AzureDevOpsBoardColumn";
import { AzureDevOpsWorkItemCard } from "../AzureDevOpsWorkItemCard";

type AzureDevOpsBoardProps = {
	items: AzureDevOpsBoardDisplayItem[];
	workspaceCountByItem: ReadonlyMap<number, number>;
	pullRequestCountByItem: ReadonlyMap<number, number>;
	onMove: (
		item: AzureDevOpsBoardDisplayItem,
		stage: AzureDevOpsBoardStage,
	) => void;
	onOpenItem: (item: AzureDevOpsBoardDisplayItem) => void;
};

export function AzureDevOpsBoard({
	items,
	workspaceCountByItem,
	pullRequestCountByItem,
	onMove,
	onOpenItem,
}: AzureDevOpsBoardProps) {
	const { t } = useLingui();
	const [activeItem, setActiveItem] =
		useState<AzureDevOpsBoardDisplayItem | null>(null);
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor),
	);
	const itemsByStage = useMemo(() => {
		const grouped = new Map<
			AzureDevOpsBoardStage,
			AzureDevOpsBoardDisplayItem[]
		>();
		for (const stage of AZURE_BOARD_STAGES) grouped.set(stage.id, []);
		for (const item of items) grouped.get(item.stage)?.push(item);
		return grouped;
	}, [items]);
	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const item = items.find(
				(candidate) => `azure-work-item-${candidate.id}` === event.active.id,
			);
			setActiveItem(item ?? null);
		},
		[items],
	);
	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const item = activeItem;
			setActiveItem(null);
			const targetStage = event.over?.data.current?.stage;
			if (!item || typeof targetStage !== "string") return;
			if (
				!canMoveAzureBoardItem(item.stage, targetStage as AzureDevOpsBoardStage)
			) {
				return;
			}
			onMove(item, targetStage as AzureDevOpsBoardStage);
		},
		[activeItem, onMove],
	);
	const labels: Record<AzureDevOpsBoardStage, string> = {
		backlog: t({ message: "Backlog" }),
		implementation: t({ message: "Implementation" }),
		homologation: t({ message: "Homologation" }),
		review: t({ message: "Review" }),
		completed: t({ message: "Completed" }),
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCorners}
			onDragStart={handleDragStart}
			onDragCancel={() => setActiveItem(null)}
			onDragEnd={handleDragEnd}
		>
			<div className="flex min-h-0 flex-1 gap-5 overflow-x-auto px-4 py-4">
				{AZURE_BOARD_STAGES.map((stage) => (
					<AzureDevOpsBoardColumn
						key={stage.id}
						stage={stage.id}
						label={labels[stage.id]}
						accentClass={stage.accentClass}
						items={itemsByStage.get(stage.id) ?? []}
						workspaceCountByItem={workspaceCountByItem}
						pullRequestCountByItem={pullRequestCountByItem}
						onOpenItem={onOpenItem}
					/>
				))}
			</div>
			{typeof document !== "undefined"
				? createPortal(
						<DragOverlay dropAnimation={null}>
							{activeItem ? (
								<AzureDevOpsWorkItemCard
									item={activeItem}
									accentClass={
										AZURE_BOARD_STAGES.find(
											(stage) => stage.id === activeItem.stage,
										)?.accentClass ?? "bg-muted-foreground"
									}
									workspaceCount={workspaceCountByItem.get(activeItem.id) ?? 0}
									pullRequestCount={
										pullRequestCountByItem.get(activeItem.id) ?? 0
									}
									onOpen={() => {}}
									overlay
								/>
							) : null}
						</DragOverlay>,
						document.body,
					)
				: null}
		</DndContext>
	);
}
