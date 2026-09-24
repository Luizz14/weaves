import { useCallback, useEffect, useMemo, useState } from "react";
import { reconcileOrganizationOrder } from "../../utils/reconcileOrganizationOrder";

export const ORGANIZATION_ORDER_STORAGE_KEY = "organization-switcher-order-v1";

export function readStoredOrder(): string[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const value = localStorage.getItem(ORGANIZATION_ORDER_STORAGE_KEY);
		if (!value) return [];
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}

function writeStoredOrder(order: readonly string[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(ORGANIZATION_ORDER_STORAGE_KEY, JSON.stringify(order));
	} catch (error) {
		console.error("[organization-switcher] Failed to persist order:", error);
	}
}

function haveSameIds(left: readonly string[], right: readonly string[]) {
	return (
		left.length === right.length &&
		left.every((id, index) => id === right[index])
	);
}

export function useOrganizationOrder(availableIds?: readonly string[]) {
	const [storedOrder, setStoredOrder] = useState(readStoredOrder);
	const order = useMemo(
		() =>
			availableIds
				? reconcileOrganizationOrder(storedOrder, availableIds)
				: storedOrder,
		[availableIds, storedOrder],
	);

	useEffect(() => {
		if (!availableIds || haveSameIds(storedOrder, order)) return;
		setStoredOrder(order);
		writeStoredOrder(order);
	}, [availableIds, order, storedOrder]);

	useEffect(() => {
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== ORGANIZATION_ORDER_STORAGE_KEY) return;
			setStoredOrder(readStoredOrder());
		};
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, []);

	const setOrder = useCallback(
		(nextOrder: readonly string[]) => {
			if (!availableIds) return;
			const reconciled = reconcileOrganizationOrder(nextOrder, availableIds);
			setStoredOrder(reconciled);
			writeStoredOrder(reconciled);
		},
		[availableIds],
	);

	return { order, setOrder };
}
