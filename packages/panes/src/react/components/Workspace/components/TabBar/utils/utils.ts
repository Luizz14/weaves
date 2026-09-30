export interface TabBounds {
	left: number;
	right: number;
}

export function computeInsertIndex(clientX: number, tabs: TabBounds[]): number {
	const index = tabs.findIndex((tab) => clientX <= (tab.left + tab.right) / 2);
	return index === -1 ? tabs.length : index;
}

export function computeInsertLineLeft(
	index: number,
	tabs: TabBounds[],
	trackLeft: number,
): number {
	return (tabs[index]?.left ?? tabs.at(-1)?.right ?? trackLeft) - trackLeft;
}
