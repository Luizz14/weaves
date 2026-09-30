import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import config from "./electron-builder";
import { packagedRuntimeExclusions } from "./runtime-dependencies";

const builderRequire = createRequire(import.meta.resolve("electron-builder"));
const { FileMatcher } = builderRequire("app-builder-lib/out/fileMatcher");
const fileStat = { isDirectory: () => false };
const root = "/virtual-app";

function filter(patterns: string[], architecture: string, source = root) {
	return new FileMatcher(
		source,
		"/bundle",
		(value: string) => value.replaceAll(`\${arch}`, architecture),
		patterns,
	).createFilter();
}

describe("packaged runtime filters", () => {
	for (const architecture of ["arm64", "x64", "ia32"]) {
		test(`retains runtime loaders and target PTY binaries for ${architecture}`, () => {
			const matches = filter(
				["**/*", ...packagedRuntimeExclusions],
				architecture,
			);
			for (const file of [
				"node_modules/node-pty/lib/utils.js",
				"node_modules/node-pty/build/Release/pty.node",
				"node_modules/node-pty/build/Release/spawn-helper",
				`node_modules/node-pty/prebuilds/win32-${architecture}/conpty.node`,
				"node_modules/better-sqlite3/build/Release/better_sqlite3.node",
				"node_modules/bindings/bindings.js",
			])
				expect(matches(`${root}/${file}`, fileStat)).toBe(true);
			const foreign = architecture === "arm64" ? "x64" : "arm64";
			expect(
				matches(
					`${root}/node_modules/node-pty/prebuilds/win32-${foreign}/conpty.node`,
					fileStat,
				),
			).toBe(false);
		});
	}
	test("excludes compilation inputs, examples and already bundled renderer datasets", () => {
		const matches = filter(["**/*", ...packagedRuntimeExclusions], "arm64");
		for (const file of [
			"node_modules/better-sqlite3/deps/sqlite3/sqlite3.c",
			"node_modules/better-sqlite3/src/better_sqlite3.cpp",
			"node_modules/node-pty/src/unix/pty.cc",
			"node_modules/node-pty/examples/basic/index.js",
			"node_modules/react-icons/lu/index.js",
			"node_modules/emojibase-data/en/data.json",
			"node_modules/pkg/cache.tsbuildinfo",
		])
			expect(matches(`${root}/${file}`, fileStat)).toBe(false);
		expect(
			matches(
				`${root}/dist/main/templates/plugin/skills/example/SKILL.md`,
				fileStat,
			),
		).toBe(true);
	});
	test("explicit native copies apply the same exclusions relative to their own roots", () => {
		const copies = config.files;
		if (!Array.isArray(copies)) throw new Error("Expected file sets");
		const copy = copies.find(
			(item) =>
				typeof item === "object" && item.from === "node_modules/node-pty",
		);
		if (!copy || typeof copy !== "object" || !Array.isArray(copy.filter))
			throw new Error("Missing PTY copy");
		const matches = filter(
			copy.filter,
			"arm64",
			`${root}/node_modules/node-pty`,
		);
		expect(
			matches(`${root}/node_modules/node-pty/src/unix/pty.cc`, fileStat),
		).toBe(false);
		expect(
			matches(
				`${root}/node_modules/node-pty/prebuilds/win32-x64/conpty.node`,
				fileStat,
			),
		).toBe(false);
		expect(
			matches(
				`${root}/node_modules/node-pty/build/Release/spawn-helper`,
				fileStat,
			),
		).toBe(true);
	});
});
