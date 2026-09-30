import type { FileTreeIconConfig } from "@pierre/trees";
import type { EditorSettings } from "@superset/shared/editor-settings";
import type { CSSProperties } from "react";
import associations from "resources/zed-icons/associations.json";

const spriteCache = new Map<string, Promise<FileTreeIconConfig>>();
export function loadZedIcons(mode: "dark" | "light") {
	const existing = spriteCache.get(mode);
	if (existing) return existing;
	const pending = fetch(new URL(`zed-icons/${mode}.svg`, location.href)).then(
		async (response) => {
			if (!response.ok) throw new Error("Could not load project icons");
			const map = (values: Record<string, string>) =>
				Object.fromEntries(
					Object.entries(values).map(([name, type]) => [name, `zed-${type}`]),
				);
			return {
				set: "minimal",
				colored: false,
				spriteSheet: await response.text(),
				byFileName: map(associations.names),
				byFileExtension: map(associations.extensions),
				remap: {
					"file-tree-icon-file": "zed-default",
					"file-tree-icon-chevron": "zed-folder",
					"file-tree-icon-lock": "zed-lock",
				},
			} satisfies FileTreeIconConfig;
		},
	);
	spriteCache.set(mode, pending);
	pending.catch(() => spriteCache.delete(mode));
	return pending;
}

export const ZED_PANEL_CSS = `
[data-item-section="content"] { flex: 1 1 auto; }
[data-item-section="decoration"] { flex: 0 1 auto; }
`;

export function zedPanelStyle(
	panel: EditorSettings["panel"],
	mode: "dark" | "light",
): CSSProperties {
	const dark = mode === "dark";
	return {
		"--trees-row-height-override": `${panel.density === "comfortable" ? 24 : 22}px`,
		"--trees-level-gap-override": `${panel.indent}px`,
		"--trees-padding-inline-override": "0",
		"--trees-item-margin-x-override": "0",
		"--trees-item-padding-x-override": "8px",
		"--trees-item-row-gap-override": "8px",
		"--trees-icon-width-override": "16px",
		"--trees-border-radius-override": "0",
		"--trees-font-size-override": "15px",
		"--trees-font-family-override":
			'"Project Plex Sans", "IBM Plex Sans", sans-serif',
		"--trees-bg-override": "var(--background)",
		"--trees-fg-override": dark ? "#8b888f" : "#797593",
		"--trees-fg-muted-override": dark ? "#8b888f" : "#9893a5",
		"--trees-bg-muted-override": dark ? "#f7f1ff08" : "#f2e9e1",
		"--trees-selected-bg-override": dark ? "#f7f1ff0c" : "#dfdad9",
		"--trees-selected-fg-override": dark ? "#f7f1ff" : "#575279",
		"--trees-selected-focused-border-color-override": dark
			? "#69676c"
			: "#b4b1c2",
		"--trees-border-color-override": dark ? "#3c3c3c" : "#dfdad9",
		"--trees-status-added-override": "#7bd88f",
		"--trees-status-untracked-override": "#7bd88f",
		"--trees-status-modified-override": "#fd9353",
		"--trees-status-deleted-override": "#fc618d",
		"--trees-status-ignored-override": dark ? "#69676c" : "#9893a5",
		fontFamily: '"Project Plex Sans", "IBM Plex Sans", sans-serif',
		scrollbarWidth: panel.scrollbar === "never" ? "none" : "auto",
	} as CSSProperties;
}

export function visibleProjectPath(
	path: string,
	panel: EditorSettings["panel"],
	ignored: Set<string>,
) {
	const rel = path.replace(/\\/g, "/").replace(/\/$/, "");
	if (panel.hideHidden && rel.split("/").some((part) => part.startsWith(".")))
		return false;
	if (
		panel.hideIgnored &&
		[...ignored].some((entry) => {
			const key = entry.replace(/\/$/, "");
			return rel === key || rel.startsWith(`${key}/`);
		})
	)
		return false;
	return true;
}
