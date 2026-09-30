import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lspServerSettingsSchema } from "@superset/shared/lsp";
import { ancestorDirectories, resolveLspLaunch } from "./adapters";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "superset-lsp-adapters-"));
	directories.push(root);
	return root;
}
async function executable(path: string) {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, "#!/bin/sh\nexit 0\n");
	await chmod(path, 0o755);
}

test("prefers local node_modules over PATH and explicit commands over both", async () => {
	const root = await fixture();
	const local = join(root, "node_modules/.bin/typescript-language-server");
	const path = join(root, "bin/typescript-language-server");
	await executable(local);
	await executable(path);
	const settings = lspServerSettingsSchema.parse({});
	expect(
		(
			await resolveLspLaunch(root, join(root, "src/view.tsx"), settings, {
				PATH: join(root, "bin"),
			})
		)?.command,
	).toBe(local);
	expect(
		(
			await resolveLspLaunch(
				root,
				join(root, "src/view.tsx"),
				{ ...settings, command: path, arguments: ["--custom"] },
				{ PATH: "" },
			)
		)?.arguments,
	).toEqual(["--custom"]);
});

test("selects pub workspace root and its FVM SDK", async () => {
	const root = await fixture();
	await mkdir(join(root, "packages/mobile/lib"), { recursive: true });
	await writeFile(
		join(root, "pubspec.yaml"),
		"name: workspace\nworkspace:\n  - packages/mobile\n",
	);
	await writeFile(
		join(root, "packages/mobile/pubspec.yaml"),
		"name: mobile\nresolution: workspace\n",
	);
	const dart = join(root, ".fvm/flutter_sdk/bin/dart");
	await executable(dart);
	const result = await resolveLspLaunch(
		root,
		join(root, "packages/mobile/lib/main.dart"),
		lspServerSettingsSchema.parse({}),
		{ PATH: "" },
	);
	expect(result?.rootPath).toBe(root);
	expect(result?.command).toBe(dart);
});

test("uses the outer Gradle settings root and reports missing executables", async () => {
	const root = await fixture();
	await mkdir(join(root, "android/app/src"), { recursive: true });
	await writeFile(
		join(root, "android/settings.gradle.kts"),
		'rootProject.name = "app"',
	);
	const result = await resolveLspLaunch(
		root,
		join(root, "android/app/src/Main.kt"),
		lspServerSettingsSchema.parse({}),
		{ PATH: "" },
	);
	expect(result?.rootPath).toBe(join(root, "android"));
	expect(result?.command).toBeNull();
	expect(ancestorDirectories("/outside/main.kt", root)).toEqual([root]);
});
