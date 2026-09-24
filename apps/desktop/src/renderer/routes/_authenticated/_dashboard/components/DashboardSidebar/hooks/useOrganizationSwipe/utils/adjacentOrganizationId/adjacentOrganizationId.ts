/** The neighbour in the switcher's order, or null at either end (no wrap-around). */
export function adjacentOrganizationId(
	order: readonly string[],
	currentId: string,
	step: 1 | -1,
): string | null {
	const index = order.indexOf(currentId);
	if (index === -1) return null;
	return order[index + step] ?? null;
}
