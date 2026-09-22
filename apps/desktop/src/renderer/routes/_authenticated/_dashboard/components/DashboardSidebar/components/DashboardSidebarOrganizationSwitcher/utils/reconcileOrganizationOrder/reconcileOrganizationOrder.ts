export function reconcileOrganizationOrder(
	storedIds: readonly string[],
	availableIds: readonly string[],
): string[] {
	const available = new Set(availableIds);
	const seen = new Set<string>();
	const reconciled: string[] = [];

	for (const id of storedIds) {
		if (!available.has(id) || seen.has(id)) continue;
		seen.add(id);
		reconciled.push(id);
	}

	for (const id of availableIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		reconciled.push(id);
	}

	return reconciled;
}
