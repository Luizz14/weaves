import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { SidebarScrollAnchor } from "./components/SidebarScrollAnchor";

interface SidebarVirtualListProps {
	items: readonly string[];
	fullItems?: readonly string[];
	isDragging: boolean;
	retainedItemIds?: readonly string[];
	children: (id: string, virtual: boolean) => ReactNode;
}

function tabbableElements(row: HTMLElement) {
	return [
		...row.querySelectorAll<HTMLElement>(
			"button, a[href], input, select, textarea, [tabindex='0']",
		),
	].filter(
		(element) =>
			!element.closest("[inert]") &&
			!element.hasAttribute("disabled") &&
			element.getClientRects().length > 0,
	);
}

export function SidebarVirtualList({
	items,
	fullItems = items,
	isDragging,
	retainedItemIds = [],
	children,
}: SidebarVirtualListProps) {
	const root = useRef<HTMLDivElement>(null);
	const [scrollMargin, setScrollMargin] = useState(0);
	const [interactedId, setInteractedId] = useState<string | null>(null);
	const pendingFocus = useRef<{ id: string; last: boolean } | null>(null);
	const getScrollElement = useCallback(
		() =>
			root.current?.closest<HTMLElement>("[data-sidebar-scroll-container]") ??
			null,
		[],
	);
	const virtual = fullItems.length >= 80 && !isDragging;
	const retainedIndexes = items.flatMap((id, index) =>
		id === interactedId || retainedItemIds.includes(id) ? [index] : [],
	);
	const getItemKey = useCallback((index: number) => items[index], [items]);
	const indexesById = useMemo(
		() => new Map(items.map((id, index) => [id, index])),
		[items],
	);
	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement,
		getItemKey,
		estimateSize: () => 28,
		overscan: 8,
		scrollMargin,
		enabled: fullItems.length >= 80,
		rangeExtractor: (range) =>
			[...new Set([...defaultRangeExtractor(range), ...retainedIndexes])].sort(
				(a, b) => a - b,
			),
	});

	useLayoutEffect(() => {
		const scroller = getScrollElement();
		if (!scroller || !root.current) return;
		const updateMargin = () => {
			if (!root.current) return;
			setScrollMargin(
				root.current.getBoundingClientRect().top -
					scroller.getBoundingClientRect().top -
					scroller.clientTop +
					scroller.scrollTop,
			);
		};
		updateMargin();
		const observer = new ResizeObserver(updateMargin);
		observer.observe(scroller);
		if (scroller.firstElementChild)
			observer.observe(scroller.firstElementChild);
		return () => observer.disconnect();
	}, [getScrollElement]);

	useLayoutEffect(() => {
		const pending = pendingFocus.current;
		if (!pending || !root.current) return;
		const row = [
			...root.current.querySelectorAll<HTMLElement>("[data-sidebar-row-id]"),
		].find((element) => element.dataset.sidebarRowId === pending.id);
		if (!row) return;
		const candidates = tabbableElements(row);
		const target = pending.last ? candidates.at(-1) : candidates[0];
		if (target) {
			pendingFocus.current = null;
			target.focus({ preventScroll: true });
			virtualizer.scrollToIndex(items.indexOf(pending.id), { align: "auto" });
		}
	});

	const virtualItems = virtualizer.getVirtualItems();
	const rendered = virtual
		? virtualItems.map((item) => ({ id: items[item.index], item }))
		: fullItems.map((id) => ({ id, item: undefined }));
	return (
		<SidebarScrollAnchor virtual={virtual}>
			<div
				ref={root}
				style={
					virtual
						? {
								height: virtualizer.getTotalSize(),
								position: "relative",
								overflowAnchor: "none",
							}
						: { overflowAnchor: "none" }
				}
				onFocusCapture={(event) => {
					const id = (event.target as HTMLElement).closest<HTMLElement>(
						"[data-sidebar-row-id]",
					)?.dataset.sidebarRowId;
					if (id) setInteractedId(id);
				}}
				onPointerDownCapture={(event) => {
					const id = (event.target as HTMLElement).closest<HTMLElement>(
						"[data-sidebar-row-id]",
					)?.dataset.sidebarRowId;
					if (id) setInteractedId(id);
				}}
				onKeyDownCapture={(event) => {
					if (
						!virtual ||
						event.key !== "Tab" ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey
					)
						return;
					const row = (event.target as HTMLElement).closest<HTMLElement>(
						"[data-sidebar-row-id]",
					);
					if (!row) return;
					const candidates = tabbableElements(row);
					if (
						event.target !==
						(event.shiftKey ? candidates[0] : candidates.at(-1))
					)
						return;
					const index = items.indexOf(row.dataset.sidebarRowId ?? "");
					const nextId = items[index + (event.shiftKey ? -1 : 1)];
					if (!nextId) return;
					event.preventDefault();
					pendingFocus.current = { id: nextId, last: event.shiftKey };
					setInteractedId(nextId);
				}}
			>
				{rendered.map(({ id, item }) => (
					<div
						key={id}
						data-sidebar-row-id={id}
						data-index={
							fullItems.length >= 80 ? indexesById.get(id) : undefined
						}
						ref={
							fullItems.length >= 80 && indexesById.has(id)
								? virtualizer.measureElement
								: undefined
						}
						style={
							item
								? {
										position: "absolute",
										top: item.start - scrollMargin,
										left: 0,
										width: "100%",
									}
								: undefined
						}
					>
						{children(id, virtual)}
					</div>
				))}
			</div>
		</SidebarScrollAnchor>
	);
}
