/** Next highlighted index; a closed switcher opens on the previous workspace, like a browser's Ctrl+Tab. */
export function stepSelection(
	current: number | null,
	count: number,
	backward: boolean,
): number | null {
	if (count === 0) return null;
	if (current === null) {
		if (count === 1) return 0;
		return backward ? count - 1 : 1;
	}
	return (current + (backward ? -1 : 1) + count) % count;
}
