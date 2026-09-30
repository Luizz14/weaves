import { expect, test } from "bun:test";
import { editorSettingsSchema } from "@superset/shared/editor-settings";
import { visibleProjectPath, zedPanelStyle } from "./zedProjectPanel";

test("visibility hides hidden and ignored subtrees without changing real file identities", () => {
	const panel = editorSettingsSchema.parse({}).panel;
	const ignored = new Set(["node_modules/", "build"]);
	expect(visibleProjectPath("lib/main.dart", panel, ignored)).toBe(true);
	expect(visibleProjectPath("lib/.hidden/value.ts", panel, ignored)).toBe(
		false,
	);
	expect(
		visibleProjectPath("node_modules/react/index.js", panel, ignored),
	).toBe(false);
	expect(visibleProjectPath("builder/value.ts", panel, ignored)).toBe(true);
	expect(
		visibleProjectPath(
			"build/value.ts",
			{ ...panel, hideIgnored: false },
			ignored,
		),
	).toBe(true);
});

test("Zed panel profile matches its measured density, indentation and color palette", () => {
	const style = zedPanelStyle(editorSettingsSchema.parse({}).panel, "dark");
	expect(Reflect.get(style, "--trees-bg-override")).toBe("var(--background)");
	expect(Reflect.get(style, "--trees-row-height-override")).toBe("24px");
	expect(Reflect.get(style, "--trees-level-gap-override")).toBe("20px");
});
