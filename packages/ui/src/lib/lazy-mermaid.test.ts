import { expect, mock, test } from "bun:test";
import { createLazyMermaidPlugin } from "./lazy-mermaid";

test("keeps diagram setup synchronous without loading the engine", () => {
	const load = mock();
	const plugin = createLazyMermaidPlugin(load);
	const instance = plugin.getMermaid({ theme: "dark" });
	instance.initialize({ theme: "default" });
	expect(load).not.toHaveBeenCalled();
	expect(plugin.language).toBe("mermaid");
});

test("loads on rendering and passes the latest initialization config and source", async () => {
	const render = mock(async () => ({ svg: "<svg>rendered</svg>" }));
	const getMermaid = mock(() => ({ initialize() {}, render }));
	const load = mock(async () => ({
		mermaid: {
			name: "mermaid" as const,
			type: "diagram" as const,
			language: "mermaid",
			getMermaid,
		},
	}));
	const instance = createLazyMermaidPlugin(load).getMermaid({ theme: "dark" });
	instance.initialize({ theme: "default", htmlLabels: false });
	expect(await instance.render("diagram-a", "flowchart LR; A-->B")).toEqual({
		svg: "<svg>rendered</svg>",
	});
	expect(getMermaid).toHaveBeenCalledWith({
		theme: "default",
		htmlLabels: false,
	});
	expect(render).toHaveBeenCalledWith("diagram-a", "flowchart LR; A-->B");
});

test("propagates engine and rendering failures to the existing caller", async () => {
	const instance = createLazyMermaidPlugin(async () => {
		throw new Error("engine unavailable");
	}).getMermaid();
	await expect(instance.render("diagram-a", "graph LR; A-->B")).rejects.toThrow(
		"engine unavailable",
	);
});
