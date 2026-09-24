import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useRef } from "react";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { readStoredOrder } from "../../components/DashboardSidebarOrganizationSwitcher/hooks/useOrganizationOrder";
import { reconcileOrganizationOrder } from "../../components/DashboardSidebarOrganizationSwitcher/utils/reconcileOrganizationOrder";
import { adjacentOrganizationId } from "./utils/adjacentOrganizationId";

const SWITCH_THRESHOLD_PX = 70;
const MAX_DRAG_PX = 72;
const DRAG_RESISTANCE = 0.55;
const FALLBACK_WIDTH_PX = 240;
const GESTURE_END_MS = 180;
const EXIT_RESTORE_MS = 1200;
const SPRING = { type: "spring", duration: 0.5, bounce: 0.1 } as const;
const EXIT = { duration: 0.16, ease: [0.4, 0, 1, 1] } as const;

function slideDistance(element: HTMLElement | null): number {
	return element?.offsetWidth || FALLBACK_WIDTH_PX;
}

function currentOrder(organizationIds: readonly string[]): string[] {
	return reconcileOrganizationOrder(readStoredOrder(), organizationIds);
}

/**
 * Two-finger horizontal trackpad swipes over `targetRef` switch to the
 * neighbouring organization; the returned motion values slide the content in
 * from the side the next organization lives on.
 */
export function useOrganizationSwipe(targetRef: RefObject<HTMLElement | null>) {
	const reduceMotion = useReducedMotion();
	const { activeOrganizationId, switchOrganization } = useCollections();
	const { data: organizations } =
		cloudTrpc.organization.list.useQuery(undefined);
	const x = useMotionValue(0);
	const opacity = useMotionValue(1);

	const organizationIdsRef = useRef<string[]>([]);
	organizationIdsRef.current = organizations?.map((org) => org.id) ?? [];
	const activeIdRef = useRef(activeOrganizationId);
	const switchRef = useRef(switchOrganization);
	switchRef.current = switchOrganization;
	const pendingStepRef = useRef<1 | -1 | null>(null);

	useEffect(() => {
		const previousId = activeIdRef.current;
		activeIdRef.current = activeOrganizationId;
		if (previousId === activeOrganizationId) return;

		const order = currentOrder(organizationIdsRef.current);
		const step =
			pendingStepRef.current ??
			(order.indexOf(activeOrganizationId) >= order.indexOf(previousId)
				? 1
				: -1);
		pendingStepRef.current = null;
		if (reduceMotion) {
			x.set(0);
			opacity.set(1);
			return;
		}
		x.jump(step * slideDistance(targetRef.current));
		opacity.jump(0.2);
		animate(x, 0, SPRING);
		animate(opacity, 1, { duration: 0.3, ease: [0.2, 0, 0, 1] });
	}, [activeOrganizationId, opacity, reduceMotion, targetRef, x]);

	useEffect(() => {
		const target = targetRef.current;
		if (!target) return;
		let accumulated = 0;
		let fired = false;
		let endTimer: ReturnType<typeof setTimeout> | null = null;
		let restoreTimer: ReturnType<typeof setTimeout> | null = null;

		const settle = () => {
			accumulated = 0;
			fired = false;
			if (pendingStepRef.current === null) animate(x, 0, SPRING);
		};

		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey) return;
			const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.5;
			if (!horizontal && accumulated === 0) return;

			if (endTimer) clearTimeout(endTimer);
			endTimer = setTimeout(settle, GESTURE_END_MS);
			if (fired) return;

			accumulated += event.deltaX;
			if (!reduceMotion) {
				const drag = Math.max(
					-MAX_DRAG_PX,
					Math.min(MAX_DRAG_PX, -accumulated * DRAG_RESISTANCE),
				);
				x.set(drag);
			}
			if (Math.abs(accumulated) < SWITCH_THRESHOLD_PX) return;

			fired = true;
			const step = accumulated > 0 ? 1 : -1;
			const nextId = adjacentOrganizationId(
				currentOrder(organizationIdsRef.current),
				activeIdRef.current,
				step,
			);
			if (!nextId) {
				animate(x, 0, SPRING);
				return;
			}
			pendingStepRef.current = step;
			if (!reduceMotion) {
				animate(x, -step * slideDistance(target), EXIT);
				animate(opacity, 0, EXIT);
			}
			if (restoreTimer) clearTimeout(restoreTimer);
			restoreTimer = setTimeout(() => {
				if (activeIdRef.current === nextId) return;
				pendingStepRef.current = null;
				animate(x, 0, SPRING);
				animate(opacity, 1, { duration: 0.2 });
			}, EXIT_RESTORE_MS);
			void switchRef.current(nextId);
		};

		target.addEventListener("wheel", onWheel, { passive: true });
		return () => {
			if (endTimer) clearTimeout(endTimer);
			if (restoreTimer) clearTimeout(restoreTimer);
			target.removeEventListener("wheel", onWheel);
		};
	}, [opacity, reduceMotion, targetRef, x]);

	return { x, opacity };
}
