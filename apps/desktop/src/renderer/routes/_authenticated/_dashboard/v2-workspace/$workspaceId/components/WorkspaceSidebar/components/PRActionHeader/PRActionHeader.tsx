import { WindowControlsInset } from "renderer/routes/_authenticated/_dashboard/components/WindowControlsInset";

/**
 * Sidebar top strip reserved for window dragging and native window controls.
 */
export function PRActionHeader() {
	return (
		<div className="flex h-10 shrink-0 items-center gap-2 bg-muted/45 px-2 dark:bg-muted/35">
			<div className="drag h-full min-w-0 flex-1" />
			<WindowControlsInset />
		</div>
	);
}
