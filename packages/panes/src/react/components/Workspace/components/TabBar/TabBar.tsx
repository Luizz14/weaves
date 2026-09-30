import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { OverflowFadeContainer } from "@superset/ui/overflow-fade-container";
import { PlusIcon } from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useRef,
	useState,
} from "react";
import { useDrop } from "react-dnd";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../core/store";
import type { Tab } from "../../../../../types";
import type { PaneRegistry } from "../../../../types";
import { getTabPaneEntries } from "../../utils/getTabPaneEntries";
import { PANE_DRAG_TYPE } from "../Tab/components/Pane/components/PaneHeader";
import { TAB_DRAG_TYPE, TabItem } from "./components/TabItem";
import { TabPaneIcon } from "./components/TabPaneIcon";
import { computeInsertIndex, computeInsertLineLeft } from "./utils";

interface TabBarProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tabs: Tab<TData>[];
	registry: PaneRegistry<TData>;
	activeTabId: string | null;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onCloseOtherTabs: (tabId: string) => void;
	onCloseAllTabs: () => void;
	onRenameTab: (tabId: string, title: string | undefined) => void;
	onReorderTab: (tabId: string, toIndex: number) => void;
	onMovePaneToNewTab: (paneId: string, toIndex: number) => void;
	renderTabIcon?: (tab: Tab<TData>) => ReactNode;
	renderAddTabMenu?: () => ReactNode;
	renderTabBarLeading?: () => ReactNode;
	renderTabBarTrailing?: () => ReactNode;
	renderTabAccessory?: (tab: Tab<TData>) => ReactNode;
}

type TabDragItem = { tabId: string };
type PaneDragItem = { paneId: string };

function AddTabButton<_TData>({
	renderAddTabMenu,
}: {
	renderAddTabMenu?: () => ReactNode;
}) {
	const button = (
		<Button
			className="ml-1.5 size-7 rounded-md border border-border/60 bg-muted/30 px-1 text-muted-foreground shadow-none hover:bg-accent/60 hover:text-foreground"
			size="icon"
			type="button"
			variant="ghost"
		>
			<PlusIcon className="size-3.5" />
		</Button>
	);

	if (renderAddTabMenu) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					{renderAddTabMenu()}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}

	return button;
}

export function TabBar<TData>({
	store,
	tabs,
	registry,
	activeTabId,
	onSelectTab,
	onCloseTab,
	onCloseOtherTabs,
	onCloseAllTabs,
	onRenameTab,
	onReorderTab,
	onMovePaneToNewTab,
	renderTabIcon,
	renderAddTabMenu,
	renderTabBarLeading,
	renderTabBarTrailing,
	renderTabAccessory,
}: TabBarProps<TData>) {
	const tabsTrackRef = useRef<HTMLDivElement>(null);
	const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

	const insertIndexRef = useRef<number | null>(null);
	const getTabBounds = () =>
		Array.from(
			tabsTrackRef.current?.querySelectorAll<HTMLElement>(
				":scope > [data-tab-id]",
			) ?? [],
			(node) => node.getBoundingClientRect(),
		);
	const [insertIndex, setInsertIndex] = useState<number | null>(null);

	const [{ isOver }, connectDrop] = useDrop(
		() => ({
			accept: [TAB_DRAG_TYPE, PANE_DRAG_TYPE],
			hover: (_item: TabDragItem | PaneDragItem, monitor) => {
				const track = tabsTrackRef.current;
				const offset = monitor.getClientOffset();
				if (!track || !offset) return;

				const idx = computeInsertIndex(offset.x, getTabBounds());
				if (idx !== insertIndexRef.current) {
					insertIndexRef.current = idx;
					setInsertIndex(idx);
				}
			},
			drop: (item: TabDragItem | PaneDragItem, monitor) => {
				const idx = insertIndexRef.current;
				if (idx === null) return;

				insertIndexRef.current = null;
				setInsertIndex(null);

				if (monitor.getItemType() === PANE_DRAG_TYPE && "paneId" in item) {
					onMovePaneToNewTab(item.paneId, idx);
					return;
				}

				if (monitor.getItemType() !== TAB_DRAG_TYPE || !("tabId" in item)) {
					return;
				}

				const dragIndex = tabs.findIndex((t) => t.id === item.tabId);
				if (dragIndex === -1) return;

				// Adjust for removal of dragged tab
				let toIndex = idx;
				if (dragIndex < toIndex) toIndex--;

				onReorderTab(item.tabId, toIndex);
			},
			collect: (monitor) => ({
				isOver: monitor.isOver(),
			}),
		}),
		[tabs, onReorderTab, onMovePaneToNewTab],
	);

	// Clear indicator when cursor leaves the tab bar
	if (!isOver && insertIndexRef.current !== null) {
		insertIndexRef.current = null;
		if (insertIndex !== null) setInsertIndex(null);
	}

	const setRootRef = useCallback(
		(node: HTMLDivElement | null) => {
			connectDrop(node);
		},
		[connectDrop],
	);

	const handleOverflowChange = useCallback<
		NonNullable<
			ComponentProps<typeof OverflowFadeContainer>["onOverflowChange"]
		>
	>((state) => {
		setHasHorizontalOverflow(state.hasOverflowX);
	}, []);

	const insertLineLeft =
		insertIndex !== null
			? computeInsertLineLeft(
					insertIndex,
					getTabBounds(),
					tabsTrackRef.current?.getBoundingClientRect().left ?? 0,
				)
			: null;

	return (
		<div
			ref={setRootRef}
			// Only the empty filler right of the tabs is an
			// Electron window-drag region — marking the whole bar `drag` and carving
			// children out with `no-drag` loses the carve-outs once they sit inside
			// the masked/scrollable OverflowFadeContainer, which made the entire bar
			// swallow clicks.
			className="group/root-tabs flex h-10 min-w-0 shrink-0 items-stretch bg-muted/45 shadow-[inset_0_-1px_0_var(--border)] dark:bg-muted/35"
		>
			{renderTabBarLeading && (
				<div className="flex h-full shrink-0 items-stretch border-b border-border">
					{renderTabBarLeading()}
				</div>
			)}
			<OverflowFadeContainer
				observeChildren
				onOverflowChange={handleOverflowChange}
				className="hide-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
			>
				<div
					ref={tabsTrackRef}
					className="no-drag relative flex h-full flex-1 items-stretch"
				>
					{tabs.map((tab, i) => (
						<div
							className="h-full w-max min-w-[120px] max-w-[320px] shrink-0 pt-1"
							data-tab-id={tab.id}
							key={tab.id}
						>
							<TabItem
								tab={tab}
								tabs={tabs}
								registry={registry}
								index={i}
								isActive={tab.id === activeTabId}
								onSelect={() => onSelectTab(tab.id)}
								onClose={() => onCloseTab(tab.id)}
								onCloseOthers={() => onCloseOtherTabs(tab.id)}
								onCloseAll={onCloseAllTabs}
								onRename={(title) => onRenameTab(tab.id, title)}
								icon={
									renderTabIcon?.(tab) ?? (
										<span className="flex min-w-0 items-center gap-1 overflow-x-auto hide-scrollbar">
											{getTabPaneEntries(tab).map(
												({ pane, parentDirection }) => (
													<TabPaneIcon
														key={pane.id}
														store={store}
														tab={tab}
														pane={pane}
														parentDirection={parentDirection}
														registry={registry}
													/>
												),
											)}
										</span>
									)
								}
								accessory={renderTabAccessory?.(tab)}
							/>
						</div>
					))}
					{insertLineLeft !== null && (
						<div
							className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-primary opacity-85"
							style={{ left: insertLineLeft }}
						/>
					)}
					<div className="flex h-full w-10 shrink-0 items-center justify-center border-b border-border">
						{!hasHorizontalOverflow && (
							<AddTabButton renderAddTabMenu={renderAddTabMenu} />
						)}
					</div>
					{/* Empty space to the right of the tabs (collapses to 0 when the
					    tabs overflow); the bar's only window-drag region. */}
					<div className="drag h-full flex-1 border-b border-border" />
				</div>
			</OverflowFadeContainer>
			{hasHorizontalOverflow && (
				<div className="no-drag flex h-full w-10 shrink-0 items-center justify-center border-b border-border">
					<AddTabButton renderAddTabMenu={renderAddTabMenu} />
				</div>
			)}
			{renderTabBarTrailing && (
				<div className="no-drag flex h-full shrink-0 items-center px-1 border-b border-border">
					{renderTabBarTrailing()}
				</div>
			)}
		</div>
	);
}
