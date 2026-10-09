import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import config from "./electron-builder";
import macosConfig, {
	macosArm64Exclusions,
} from "./electron-builder.local-macos";
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

describe("local macOS arm64 package", () => {
	test("only configures local macOS arm64 artifacts", () => {
		expect(macosConfig.directories?.output).toBe("release-local-macos");
		expect(macosConfig.mac?.target).toEqual([
			{ target: "dmg", arch: ["arm64"] },
			{ target: "zip", arch: ["arm64"] },
		]);
		expect(macosConfig.mac?.notarize).toBe(false);
		expect(macosConfig.win).toBeUndefined();
		expect(macosConfig.linux).toBeUndefined();
		expect(config.win).toBeDefined();
		expect(config.linux).toBeDefined();
	});

	test("excludes foreign platform payloads from automatic dependency collection", () => {
		const matches = filter(["**/*", ...macosArm64Exclusions], "arm64");
		for (const file of [
			"node_modules/node-pty/prebuilds/win32-arm64/conpty.node",
			"node_modules/node-pty/prebuilds/linux-arm64/pty.node",
			"node_modules/node-pty/prebuilds/darwin-x64/pty.node",
			"node_modules/bufferutil/prebuilds/win32-x64/bufferutil.node",
			"node_modules/utf-8-validate/prebuilds/linux-x64/utf-8-validate.node",
			"node_modules/@ast-grep/napi-win32-arm64-msvc/binding.node",
			"node_modules/@parcel/watcher-linux-arm64-glibc/watcher.node",
			"node_modules/@napi-rs/keyring-darwin-x64/keyring.node",
			"node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
			"node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
			"resources/build/icons/icon.ico",
			"node_modules/pkg/build/Release/conpty.pdb",
			"node_modules/pkg/build/Release/conpty.dll",
		]) {
			expect(matches(`${root}/${file}`, fileStat)).toBe(false);
		}
		for (const file of [
			"node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
			"node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
			"node_modules/node-pty/build/Release/pty.node",
			"node_modules/node-pty/lib/utils.js",
			"node_modules/@ast-grep/napi/index.js",
			"node_modules/@ast-grep/napi-darwin-arm64/binding.node",
			"node_modules/@parcel/watcher-darwin-arm64/watcher.node",
			"node_modules/@napi-rs/keyring-darwin-arm64/keyring.node",
			"node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
			"resources/build/icons/icon.icns",
			"dist/renderer/index.html",
		]) {
			expect(matches(`${root}/${file}`, fileStat)).toBe(true);
		}
	});

	test("applies platform exclusions relative to explicit copy roots", () => {
		const files = macosConfig.files;
		if (!Array.isArray(files)) throw new Error("Expected file sets");
		for (const [source, excluded, retained] of [
			[
				"node_modules/node-pty",
				"prebuilds/win32-arm64/conpty.node",
				"prebuilds/darwin-arm64/pty.node",
			],
			[
				"node_modules/@ast-grep",
				"napi-win32-arm64-msvc/binding.node",
				"napi-darwin-arm64/binding.node",
			],
			[
				"node_modules/@parcel",
				"watcher-darwin-x64/watcher.node",
				"watcher-darwin-arm64/watcher.node",
			],
			[
				"node_modules/@napi-rs",
				"keyring-linux-arm64-gnu/keyring.node",
				"keyring-darwin-arm64/keyring.node",
			],
			["src/resources", "build/icons/icon.ico", "build/icons/icon.icns"],
		]) {
			const copy = files.find(
				(item) => typeof item === "object" && item.from === source,
			);
			if (!copy || typeof copy !== "object" || !Array.isArray(copy.filter))
				throw new Error(`Missing copy: ${source}`);
			const matches = filter(copy.filter, "arm64", `${root}/${source}`);
			expect(matches(`${root}/${source}/${excluded}`, fileStat)).toBe(false);
			expect(matches(`${root}/${source}/${retained}`, fileStat)).toBe(true);
		}
	});

	test("excludes Windows executables from resources outside ASAR", () => {
		const resources = macosConfig.extraResources;
		if (!Array.isArray(resources)) throw new Error("Expected resource sets");
		const copy = resources.find(
			(item) => typeof item === "object" && item.from === "dist/resources/bin",
		);
		if (!copy || typeof copy !== "object" || !Array.isArray(copy.filter))
			throw new Error("Missing bundled CLI copy");
		const matches = filter(copy.filter, "arm64", `${root}/dist/resources/bin`);
		expect(matches(`${root}/dist/resources/bin/superset.exe`, fileStat)).toBe(
			false,
		);
		expect(matches(`${root}/dist/resources/bin/superset`, fileStat)).toBe(true);
	});
});
