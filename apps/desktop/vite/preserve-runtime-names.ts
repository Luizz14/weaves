import { type Plugin, transformWithEsbuild } from "vite";

const NAME_SENSITIVE_MODULES = [
	/\/packages\/pty-daemon\/src\/[Pp]ty\/Pty\.ts$/,
	/\/node_modules\/posthog-node\/dist\/extensions\/feature-flags\/feature-flags\.mjs$/,
	/\/node_modules\/@anthropic-ai\/claude-agent-sdk\/sdk\.mjs$/,
	/\/node_modules\/@modelcontextprotocol\/sdk\/dist\/(?:esm|cjs)\/(?:client|server)\/(?:stdio|sse|streamableHttp|webStandardStreamableHttp)\.js$/,
];

export async function preserveRuntimeNames(code: string, id: string) {
	if (!NAME_SENSITIVE_MODULES.some((pattern) => pattern.test(id))) return null;
	const result = await transformWithEsbuild(code, id, {
		keepNames: true,
		target: "esnext",
		sourcemap: true,
	});
	return { code: result.code, map: JSON.stringify(result.map) };
}

export function preserveRuntimeNamesPlugin(): Plugin {
	return {
		name: "preserve-runtime-names",
		apply: "build",
		transform: preserveRuntimeNames,
	};
}
