import { builtInThemes, type Theme } from "@superset/shared/themes";

interface ThemeSelection {
	activeThemeId: string;
	customThemes: Theme[];
	systemLightThemeId?: string;
	systemDarkThemeId?: string;
}

const FALLBACK_BACKGROUND = { dark: "#252525", light: "#ffffff" } as const;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The color a window paints before the renderer's CSS loads: the background of
 * the theme the renderer is about to apply, so showing the window early does
 * not flash a different color.
 */
export function resolveWindowBackground(
	selection: ThemeSelection | null,
	prefersDark: boolean,
): string {
	const themeId =
		!selection || selection.activeThemeId === "system"
			? prefersDark
				? (selection?.systemDarkThemeId ?? "dark")
				: (selection?.systemLightThemeId ?? "light")
			: selection.activeThemeId;
	const theme =
		selection?.customThemes.find((candidate) => candidate.id === themeId) ??
		builtInThemes.find((candidate) => candidate.id === themeId);
	const background = theme?.ui.background;
	if (background && HEX_COLOR.test(background)) return background;
	const type = theme?.type ?? (prefersDark ? "dark" : "light");
	return FALLBACK_BACKGROUND[type];
}
