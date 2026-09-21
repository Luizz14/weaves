import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { useCallback, useMemo, useRef } from "react";
import { useHotkey } from "renderer/hotkeys";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { OrganizationSwitcherItem } from "./components/OrganizationSwitcherItem";
import { useOrganizationOrder } from "./hooks/useOrganizationOrder";
import type { SidebarOrganization } from "./types";

interface DashboardSidebarOrganizationSwitcherProps {
	isCollapsed: boolean;
}

export function DashboardSidebarOrganizationSwitcher({
	isCollapsed,
}: DashboardSidebarOrganizationSwitcherProps) {
	const { t } = useLingui();
	const collections = useCollections();
	const { data: organizations } =
		cloudTrpc.organization.list.useQuery(undefined);
	const listedOrganizations = useMemo<SidebarOrganization[] | undefined>(
		() =>
			organizations?.map((organization) => ({
				id: organization.id,
				name: organization.name,
				logo: organization.logo,
			})),
		[organizations],
	);
	const lastOrganizationsRef = useRef<SidebarOrganization[]>([]);
	if (listedOrganizations) lastOrganizationsRef.current = listedOrganizations;
	const visibleOrganizations =
		listedOrganizations ?? lastOrganizationsRef.current;
	const hasOrganizationSnapshot =
		listedOrganizations !== undefined ||
		lastOrganizationsRef.current.length > 0;
	const availableIds = useMemo(
		() =>
			hasOrganizationSnapshot
				? visibleOrganizations.map((organization) => organization.id)
				: undefined,
		[hasOrganizationSnapshot, visibleOrganizations],
	);
	const { order, setOrder } = useOrganizationOrder(availableIds);
	const orderedOrganizations = useMemo(() => {
		const byId = new Map(
			visibleOrganizations.map((organization) => [
				organization.id,
				organization,
			]),
		);
		return order.flatMap((id) => {
			const organization = byId.get(id);
			return organization ? [organization] : [];
		});
	}, [order, visibleOrganizations]);

	const switchByIndex = useCallback(
		(index: number) => {
			const organization = orderedOrganizations[index];
			if (organization) void collections.switchOrganization(organization.id);
		},
		[collections, orderedOrganizations],
	);

	const shortcut1 = useHotkey("SWITCH_ORGANIZATION_1", () => switchByIndex(0));
	const shortcut2 = useHotkey("SWITCH_ORGANIZATION_2", () => switchByIndex(1));
	const shortcut3 = useHotkey("SWITCH_ORGANIZATION_3", () => switchByIndex(2));
	const shortcut4 = useHotkey("SWITCH_ORGANIZATION_4", () => switchByIndex(3));
	const shortcut5 = useHotkey("SWITCH_ORGANIZATION_5", () => switchByIndex(4));
	const shortcut6 = useHotkey("SWITCH_ORGANIZATION_6", () => switchByIndex(5));
	const shortcut7 = useHotkey("SWITCH_ORGANIZATION_7", () => switchByIndex(6));
	const shortcut8 = useHotkey("SWITCH_ORGANIZATION_8", () => switchByIndex(7));
	const shortcut9 = useHotkey("SWITCH_ORGANIZATION_9", () => switchByIndex(8));
	const shortcuts = [
		shortcut1.text,
		shortcut2.text,
		shortcut3.text,
		shortcut4.text,
		shortcut5.text,
		shortcut6.text,
		shortcut7.text,
		shortcut8.text,
		shortcut9.text,
	];

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 180, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const oldIndex = order.indexOf(String(active.id));
			const newIndex = order.indexOf(String(over.id));
			if (oldIndex < 0 || newIndex < 0) return;
			setOrder(arrayMove(order, oldIndex, newIndex));
		},
		[order, setOrder],
	);

	if (orderedOrganizations.length === 0) return null;

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
		>
			<SortableContext
				items={order}
				strategy={
					isCollapsed
						? verticalListSortingStrategy
						: horizontalListSortingStrategy
				}
			>
				<div
					role="toolbar"
					aria-label={t({ message: "Switch organization" })}
					className={cn(
						"bg-background/55 p-1 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:shadow-[0_0_0_1px_rgba(255,255,255,0.07)]",
						isCollapsed
							? "mx-auto mb-2 flex w-12 flex-col items-center gap-1 rounded-xl"
							: "mx-2 mb-2 flex min-h-12 items-center gap-1 overflow-x-auto rounded-xl hide-scrollbar",
					)}
				>
					{orderedOrganizations.map((organization, index) => (
						<OrganizationSwitcherItem
							key={organization.id}
							organization={organization}
							isActive={organization.id === collections.activeOrganizationId}
							isCollapsed={isCollapsed}
							shortcut={shortcuts[index]}
							onSelect={() =>
								void collections.switchOrganization(organization.id)
							}
						/>
					))}
				</div>
			</SortableContext>
		</DndContext>
	);
}
