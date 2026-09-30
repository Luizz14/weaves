import type { DiagramPlugin } from "@streamdown/mermaid";

export function createLazyMermaidPlugin(
	load: () => Promise<{ mermaid: DiagramPlugin }>,
): DiagramPlugin {
	return {
		name: "mermaid",
		type: "diagram",
		language: "mermaid",
		getMermaid(config) {
			let currentConfig = config;
			return {
				initialize(nextConfig) {
					currentConfig = nextConfig;
				},
				async render(id, source) {
					const { mermaid } = await load();
					return mermaid.getMermaid(currentConfig).render(id, source);
				},
			};
		},
	};
}
