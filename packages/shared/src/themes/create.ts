import { wcagContrast } from "culori";
import { darkTheme, lightTheme } from "./built-in";
import { getDefaultTerminalColors, type Theme, type UIColors } from "./types";
import { toHex, withAlpha } from "./utils";

export interface CreateThemeFromColorsInput {
	id: string;
	name: string;
	type: "dark" | "light";
	/** Main app background. */
	background: string;
	/** Main app text color. */
	foreground: string;
	/** Brand/accent color used for primary actions, focus rings, and highlights. */
	accent: string;
	/** Border/divider color. Falls back to a translucent version of `foreground`. */
	border?: string;
	/** Muted/subtle surface color (e.g. secondary panels, disabled states). */
	muted?: string;
	/** Secondary surface color (e.g. secondary buttons). */
	secondary?: string;
	/** Destructive/error action color. */
	destructive?: string;
	/**
	 * Theme to derive every other token from (chart colors, syntax colors,
	 * etc). Defaults to the built-in theme matching `type`.
	 */
	baseTheme?: Theme;
}

function pickForeground(background: string): string {
	const contrastWithDark = wcagContrast(background, "#0a0a0a");
	const contrastWithLight = wcagContrast(background, "#fafafa");
	return contrastWithLight >= contrastWithDark ? "#fafafa" : "#0a0a0a";
}

/**
 * Builds a full theme from a handful of key colors (background, foreground,
 * accent, and optionally border/muted/secondary/destructive), deriving every
 * other UI/terminal token from a built-in base theme of the same type so the
 * rest of the palette still looks intentional.
 */
export function createThemeFromColors(input: CreateThemeFromColorsInput): Theme {
	const base =
		input.baseTheme ?? (input.type === "light" ? lightTheme : darkTheme);
	const background = toHex(input.background);
	const foreground = toHex(input.foreground);
	const accent = toHex(input.accent);
	const accentForeground = pickForeground(accent);
	const border = input.border
		? toHex(input.border)
		: withAlpha(foreground, 0.12);
	const muted = input.muted ? toHex(input.muted) : base.ui.muted;
	const mutedForeground = input.muted
		? pickForeground(muted)
		: withAlpha(foreground, 0.6);
	const secondary = input.secondary ? toHex(input.secondary) : base.ui.secondary;
	const secondaryForeground = input.secondary
		? pickForeground(secondary)
		: base.ui.secondaryForeground;
	const destructive = input.destructive
		? toHex(input.destructive)
		: base.ui.destructive;
	const destructiveForeground = input.destructive
		? pickForeground(destructive)
		: base.ui.destructiveForeground;

	const ui: UIColors = {
		...base.ui,
		background,
		foreground,
		card: background,
		cardForeground: foreground,
		popover: background,
		popoverForeground: foreground,
		primary: accent,
		primaryForeground: accentForeground,
		muted,
		mutedForeground,
		secondary,
		secondaryForeground,
		destructive,
		destructiveForeground,
		border,
		input: withAlpha(foreground, 0.16),
		ring: accent,
		sidebar: background,
		sidebarForeground: foreground,
		sidebarPrimary: accent,
		sidebarPrimaryForeground: accentForeground,
		sidebarBorder: border,
		sidebarRing: accent,
		highlight: accent,
		highlightForeground: accentForeground,
	};

	return {
		id: input.id,
		name: input.name,
		type: input.type,
		author: "You",
		description: "Custom Superset theme",
		ui,
		terminal: {
			...getDefaultTerminalColors(input.type),
			background,
			foreground,
			cursor: accent,
			blue: accent,
			brightBlue: accent,
		},
		isCustom: true,
	};
}

/**
 * Normalizes a theme name into a URL/id-safe slug.
 */
export function slugifyThemeId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
