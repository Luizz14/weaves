import { getNativeDisplaySnapshot } from "main/native/platform";
import type { WindowState } from "./window-state";

export interface Rectangle {
	x: number;
	y: number;
	width: number;
	height: number;
}

const MIN_VISIBLE_OVERLAP = 50;
const MIN_WINDOW_SIZE = 400;
interface DisplayLike {
	bounds: Rectangle;
	workAreaSize: {
		width: number;
		height: number;
	};
}

interface ScreenLike {
	getAllDisplays(): DisplayLike[];
	getPrimaryDisplay(): DisplayLike;
	/** The display whose bounds most closely match the given rect — used to
	 *  clamp saved dimensions against the display the window actually last
	 *  sat on, not always the primary one (see clampToWorkArea). */
	getDisplayMatching(rect: Rectangle): DisplayLike;
}

let screenOverride: ScreenLike | null = null;

function getScreen(): ScreenLike {
	if (screenOverride) {
		return screenOverride;
	}

	const displays = getNativeDisplaySnapshot();
	if (displays.length === 0) {
		throw new Error("Native display metadata is unavailable");
	}
	const primaryDisplay = displays[0];
	if (!primaryDisplay)
		throw new Error("Native display metadata is unavailable");
	const toDisplay = (display: (typeof displays)[number]): DisplayLike => ({
		bounds: display.bounds,
		workAreaSize: display.workAreaSize,
	});
	return {
		getAllDisplays: () => displays.map(toDisplay),
		getPrimaryDisplay: () => toDisplay(primaryDisplay),
		getDisplayMatching: (rect) => {
			let best = primaryDisplay;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const display of displays) {
				const dx = display.bounds.x - rect.x;
				const dy = display.bounds.y - rect.y;
				const distance = dx * dx + dy * dy;
				if (distance < bestDistance) {
					best = display;
					bestDistance = distance;
				}
			}
			return toDisplay(best);
		},
	};
}

export function setScreenForTesting(screen: ScreenLike | null): void {
	screenOverride = screen;
}

/**
 * Checks if bounds overlap at least MIN_VISIBLE_OVERLAP pixels with any display.
 * Returns false if window would be completely off-screen (e.g., monitor disconnected).
 */
export function isVisibleOnAnyDisplay(bounds: Rectangle): boolean {
	const displays = getScreen().getAllDisplays();

	return displays.some((display) => {
		const db = display.bounds;
		return (
			bounds.x < db.x + db.width - MIN_VISIBLE_OVERLAP &&
			bounds.x + bounds.width > db.x + MIN_VISIBLE_OVERLAP &&
			bounds.y < db.y + db.height - MIN_VISIBLE_OVERLAP &&
			bounds.y + bounds.height > db.y + MIN_VISIBLE_OVERLAP
		);
	});
}

/**
 * Clamps saved dimensions to not exceed the work area of the display the
 * saved position (x/y) actually sits on — not always the primary display.
 * A window last closed maximized/full-height on a secondary monitor larger
 * than the primary one would otherwise get its saved width/height shrunk
 * down to the primary's work area on relaunch, while x/y still point at the
 * secondary monitor: the window ends up correctly positioned but sized far
 * smaller than the screen it's on. getDisplayMatching finds the display
 * nearest the saved rect (falls back sanely if the saved rect covers none),
 * so this also still handles DPI/resolution changes on that same display.
 */
function clampToWorkArea(bounds: Rectangle): { width: number; height: number } {
	const { workAreaSize } = getScreen().getDisplayMatching(bounds);
	return {
		width: Math.min(
			Math.max(bounds.width, MIN_WINDOW_SIZE),
			workAreaSize.width,
		),
		height: Math.min(
			Math.max(bounds.height, MIN_WINDOW_SIZE),
			workAreaSize.height,
		),
	};
}

export interface InitialWindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
	center: boolean;
	isMaximized: boolean;
}

/**
 * Computes initial window bounds from saved state, with fallbacks.
 *
 * - No saved state → default to primary display size, centered
 * - Saved position visible → restore exactly
 * - Saved position not visible (monitor disconnected) → use saved size, but center
 */
export function getInitialWindowBounds(
	savedState: WindowState | null,
): InitialWindowBounds {
	const { workAreaSize } = getScreen().getPrimaryDisplay();

	// No saved state → default to primary display size, centered
	if (!savedState) {
		return {
			width: workAreaSize.width,
			height: workAreaSize.height,
			center: true,
			isMaximized: false,
		};
	}

	const { width, height } = clampToWorkArea({
		x: savedState.x,
		y: savedState.y,
		width: savedState.width,
		height: savedState.height,
	});

	const savedBounds: Rectangle = {
		x: savedState.x,
		y: savedState.y,
		width,
		height,
	};

	// Saved position visible on a connected display → restore exactly
	if (isVisibleOnAnyDisplay(savedBounds)) {
		return {
			x: savedState.x,
			y: savedState.y,
			width,
			height,
			center: false,
			isMaximized: savedState.isMaximized,
		};
	}

	// Position not visible (monitor disconnected) → use saved size, but center
	return {
		width,
		height,
		center: true,
		isMaximized: savedState.isMaximized,
	};
}
