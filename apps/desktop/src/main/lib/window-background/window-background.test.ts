import { describe, expect, test } from "bun:test";
import { darkTheme, lightTheme, type Theme } from "@superset/shared/themes";
import { resolveWindowBackground } from "./window-background";

function customTheme(
	id: string,
	type: Theme["type"],
	background: string,
): Theme {
	return {
		...darkTheme,
		id,
		name: id,
		type,
		ui: { ...darkTheme.ui, background },
	};
}

describe("resolveWindowBackground", () => {
	test("follows the OS through the system theme pair", () => {
		const selection = {
			activeThemeId: "system",
			customThemes: [
				customTheme("night", "dark", "#1b1e28"),
				customTheme("dawn", "light", "#faf4ed"),
			],
			systemLightThemeId: "dawn",
			systemDarkThemeId: "night",
		};

		expect(resolveWindowBackground(selection, true)).toBe("#1b1e28");
		expect(resolveWindowBackground(selection, false)).toBe("#faf4ed");
	});

	test("uses an explicit theme regardless of the OS", () => {
		const selection = { activeThemeId: lightTheme.id, customThemes: [] };

		expect(resolveWindowBackground(selection, true)).toBe(
			lightTheme.ui.background,
		);
	});

	test("falls back by theme type when the color cannot be painted natively", () => {
		const selection = {
			activeThemeId: "oklch-theme",
			customThemes: [customTheme("oklch-theme", "light", "oklch(0.9 0 0)")],
		};

		expect(resolveWindowBackground(selection, true)).toBe("#ffffff");
		expect(resolveWindowBackground(null, true)).toBe(darkTheme.ui.background);
	});
});
