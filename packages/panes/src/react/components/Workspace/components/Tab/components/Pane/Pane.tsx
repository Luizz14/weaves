import { useCallback, useMemo, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../../../core/store";
import type {
	Pane as PaneType,
	SplitPosition,
	Tab,
} from "../../../../../../../types";
import type {
	ContextMenuActionConfig,
	PaneActionConfig,
	PaneRegistry,
	RendererContext,
} from "../../../../../../types";
import { usePaneContext } from "../../../../hooks/usePaneContext";
import { TAB_DRAG_TYPE } from "../../../TabBar/components/TabItem";
import { PANE_MIN_SIZE_CLASS_NAME } from "../../constants";
import { DropZoneOverlay } from "./components/DropZoneOverlay";
import { PaneContent } from "./components/PaneContent";
import { PaneContextMenu } from "./components/PaneContextMenu";
import { PANE_DRAG_TYPE, PaneHeader } from "./components/PaneHeader";

type PaneDropItem = { paneId: string } | { tabId: string; index: number };

interface PaneComponentProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: Tab<TData>;
	pane: PaneType<TData>;
	isActive: boolean;
	registry: PaneRegistry<TData>;
	// null only for a solo pane (the layout root)
	parentDirection?: "horizontal" | "vertical" | null;
	paneActions?:
		| PaneActionConfig<TData>[]
		| ((context: RendererContext<TData>) => PaneActionConfig<TData>[]);
	contextMenuActions?:
		| ContextMenuActionConfig<TData>[]
		| ((context: RendererContext<TData>) => ContextMenuActionConfig<TData>[]);
}

function resolveActions<TData, TAction>(
	config:
		| TAction[]
		| ((context: RendererContext<TData>, defaults: TAction[]) => TAction[])
		| undefined,
	context: RendererContext<TData>,
	defaults: TAction[],
): TAction[] {
	if (!config) return defaults;
	if (typeof config === "function") return config(context, defaults);
	return config;
}

function getDropPosition(
	clientX: number,
	clientY: number,
	rect: DOMRect,
): SplitPosition {
	const cx = rect.left + rect.width / 2;
	const cy = rect.top + rect.height / 2;
	const dx = clientX - cx;
	const dy = clientY - cy;
	if (Math.abs(dx) > Math.abs(dy)) {
		return dx > 0 ? "right" : "left";
	}
	return dy > 0 ? "bottom" : "top";
}

export function Pane<TData>({
	store,
	tab,
	pane,
	isActive,
	registry,
	parentDirection = null,
	paneActions,
	contextMenuActions,
}: PaneComponentProps<TData>) {
	const definition = registry[pane.kind];

	const { context } = usePaneContext({
		store,
		tab,
		pane,
		isActive,
		registry,
		parentDirection,
		paneActions,
	});

	const resolvedContextMenuActions = useMemo(() => {
		const workspaceResolved =
			typeof contextMenuActions === "function"
				? contextMenuActions(context)
				: (contextMenuActions ?? []);

		return resolveActions(
			definition?.contextMenuActions,
			context,
			workspaceResolved,
		);
	}, [context, contextMenuActions, definition]);

	const dropPositionRef = useRef<SplitPosition | null>(null);
	const [dropPosition, setDropPosition] = useState<SplitPosition | null>(null);
	const dropRef = useRef<HTMLDivElement>(null);

	const [{ isOver, canDrop }, connectDrop] = useDrop(
		() => ({
			accept: [PANE_DRAG_TYPE, TAB_DRAG_TYPE],
			canDrop: (item: PaneDropItem, monitor) => {
				// Can't drop a tab onto a pane it already owns, or a pane onto itself.
				if (monitor.getItemType() === TAB_DRAG_TYPE) {
					return "tabId" in item && item.tabId !== tab.id;
				}
				return "paneId" in item && item.paneId !== pane.id;
			},
			hover: (_item, monitor) => {
				const offset = monitor.getClientOffset();
				const el = dropRef.current;
				if (!offset || !el) return;
				const rect = el.getBoundingClientRect();
				const pos = getDropPosition(offset.x, offset.y, rect);
				if (pos !== dropPositionRef.current) {
					dropPositionRef.current = pos;
					setDropPosition(pos);
				}
			},
			drop: (item: PaneDropItem, monitor) => {
				const pos = dropPositionRef.current;
				if (!pos) return;
				if (monitor.getItemType() === TAB_DRAG_TYPE && "tabId" in item) {
					store.getState().moveTabToSplit({
						sourceTabId: item.tabId,
						targetPaneId: pane.id,
						position: pos,
					});
					return;
				}
				if ("paneId" in item) {
					store.getState().movePaneToSplit({
						sourcePaneId: item.paneId,
						targetPaneId: pane.id,
						position: pos,
					});
				}
			},
			collect: (monitor) => ({
				isOver: monitor.isOver(),
				canDrop: monitor.canDrop(),
			}),
		}),
		[pane.id, tab.id, store],
	);

	// Merge refs: connectDrop needs a node, and we need dropRef for rect calculations
	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			(dropRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
			connectDrop(node);
		},
		[connectDrop],
	);

	// Clear drop position when not hovering
	if (!isOver && dropPositionRef.current !== null) {
		dropPositionRef.current = null;
		if (dropPosition !== null) setDropPosition(null);
	}

	const title = definition
		? (pane.titleOverride ?? definition.getTitle?.(pane) ?? pane.id)
		: `Unknown: ${pane.kind}`;
	const icon = definition?.getIcon?.(context);
	const titleContent = definition?.renderTitle?.(context);
	const headerExtras = definition?.renderHeaderExtras?.(context);
	const toolbar = definition?.renderToolbar?.(context);

	const isDropTarget = isOver && canDrop;

	return (
		<PaneContextMenu actions={resolvedContextMenuActions} context={context}>
			<div
				ref={setRefs}
				// @container/pane-header: header pieces collapse by the pane's own
				// width (panes resize independently of the viewport). Lives here,
				// not on the header, so the containment's stacking context still
				// holds both the header's absolute popovers and the pane's banners.
				className={`@container/pane-header relative flex h-full w-full ${PANE_MIN_SIZE_CLASS_NAME} flex-col overflow-hidden border-2 transition-colors duration-150 ${
					isActive && parentDirection !== null
						? "border-primary/15"
						: "border-transparent"
				}`}
				onPointerDownCapture={context.actions.focus}
			>
				{!(parentDirection === null && definition?.hideHeaderWhenSolo) && (
					<PaneHeader
						title={title}
						icon={icon}
						isActive={isActive}
						titleContent={titleContent}
						headerExtras={headerExtras}
						toolbar={toolbar}
						actionsContent={context.headerActions}
						paneId={pane.id}
						onClick={
							definition?.onHeaderClick
								? () => definition.onHeaderClick?.(context)
								: context.actions.pin
						}
						onMiddleClick={context.actions.close}
					/>
				)}
				<PaneContent>
					{definition ? (
						definition.renderPane(context)
					) : (
						<div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
							Unknown pane kind: {pane.kind}
						</div>
					)}
				</PaneContent>
				{isDropTarget && <DropZoneOverlay position={dropPosition} />}
			</div>
		</PaneContextMenu>
	);
}
