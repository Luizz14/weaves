import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectFormatter, formatWithProcess } from "./format";

test("automatic formatting prefers Biome, then Prettier, and keeps Dart on its SDK", async () => {
	const root = await mkdtemp(join(tmpdir(), "superset-format-"));
	try {
		await writeFile(join(root, "biome.jsonc"), "{}");
		await writeFile(join(root, ".prettierrc"), "{}");
		expect(await detectProjectFormatter([root], "ts")).toBe("biome");
		expect(
			await detectProjectFormatter(
				[root],
				"ts",
				async (tool) => tool === "prettier",
			),
		).toBe("prettier");
		expect(await detectProjectFormatter([root], "yaml")).toBe("prettier");
		expect(await detectProjectFormatter([root], "dart")).toBe("dart");
		expect(await detectProjectFormatter([root], "kt")).toBeNull();
		await rm(join(root, "biome.jsonc"));
		expect(await detectProjectFormatter([root], "ts")).toBe("prettier");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("formatter subprocess consumes stdin and returns stdout without writing the source file", async () => {
	const output = await formatWithProcess(
		process.execPath,
		[
			"-e",
			"process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>process.stdout.write(input.toUpperCase()))",
		],
		tmpdir(),
		{ PATH: process.env.PATH ?? "" },
		"unsaved value",
	);
	expect(output).toBe("UNSAVED VALUE");
	await expect(
		formatWithProcess(
			process.execPath,
			[
				"-e",
				"process.stderr.write('formatter rejected input');process.exit(1)",
			],
			tmpdir(),
			{ PATH: process.env.PATH ?? "" },
			"invalid",
		),
	).rejects.toThrow("formatter rejected input");
});
