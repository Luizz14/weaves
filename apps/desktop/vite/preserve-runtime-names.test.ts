import { expect, test } from "bun:test";
import { transformWithEsbuild } from "vite";
import { preserveRuntimeNames } from "./preserve-runtime-names";

const source = `
export class RequiresServerEvaluation extends Error {
  constructor() { super(); this.name = this.constructor.name; }
}
export const observedName = new RequiresServerEvaluation().name;
`;

for (const id of [
	"/repo/packages/pty-daemon/src/Pty/Pty.ts",
	"/repo/node_modules/posthog-node/dist/extensions/feature-flags/feature-flags.mjs",
	"/repo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
	"/repo/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js",
]) {
	test(`retains constructor names through final minification: ${id}`, async () => {
		const preserved = await preserveRuntimeNames(source, id);
		expect(preserved).not.toBeNull();
		if (!preserved) throw new Error("Expected a name-sensitive module");
		const minified = await transformWithEsbuild(preserved.code, "fixture.js", {
			minify: true,
			target: "node24",
		});
		const result = await import(
			`data:text/javascript;base64,${Buffer.from(minified.code).toString("base64")}`
		);
		expect(result.observedName).toBe("RequiresServerEvaluation");
		expect(JSON.parse(preserved.map).sourcesContent).toContain(source);
	});
}

test("leaves ordinary application modules available for name minification", async () => {
	expect(await preserveRuntimeNames(source, "/repo/src/example.ts")).toBeNull();
});
