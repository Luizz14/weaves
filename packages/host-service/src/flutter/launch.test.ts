import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandLaunchValue, readFlutterProfiles } from "./launch";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.map((root) => rm(root, { recursive: true, force: true })),
	);
	roots.length = 0;
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "superset-flutter-"));
	roots.push(root);
	await mkdir(join(root, "lib"));
	await mkdir(join(root, ".vscode"));
	await writeFile(
		join(root, "pubspec.yaml"),
		"name: fixture\ndependencies:\n  flutter:\n    sdk: flutter\n",
	);
	await writeFile(join(root, "lib/main.dart"), "void main() {}\n");
	return root;
}
test("JSONC profiles expand arguments and preserve environment precedence", async () => {
	const root = await fixture();
	await writeFile(join(root, "vars.env"), "TOKEN=file\nFILE_ONLY=yes\n");
	await writeFile(
		join(root, ".vscode/launch.json"),
		`{ // comment
 configurations: [{ name: 'App', type: 'dart', request: 'launch', program: '\u0024{workspaceFolder}/lib/main.dart', envFile: 'vars.env', env: { TOKEN: 'explicit' }, args: ['\u0024{env:HOST}'], toolArgs: ['--dart-define=MODE=dev'], }], }`,
	);
	const [entry] = await readFlutterProfiles(root, undefined, {
		HOST: "host",
		TOKEN: "host",
	});
	expect(entry?.profile.diagnostics).toEqual([]);
	expect(entry?.args).toEqual(["host"]);
	expect(entry?.env.TOKEN).toBe("explicit");
	expect(entry?.env.FILE_ONLY).toBe("yes");
	expect(entry?.profile).not.toHaveProperty("env");
	const firstHash = entry?.profile.hash;
	await writeFile(join(root, "vars.env"), "TOKEN=changed\n");
	expect(
		(await readFlutterProfiles(root, undefined, {}))[0]?.profile.hash,
	).not.toBe(firstHash);
});
test("unsupported tasks, attach, compounds and unresolved inputs remain disabled", async () => {
	const root = await fixture();
	await writeFile(
		join(root, ".vscode/launch.json"),
		JSON.stringify({
			configurations: [
				{ name: "Attach", type: "dart", request: "attach" },
				{ name: "Task", type: "dart", preLaunchTask: "build" },
				{ name: "Input", type: "dart", args: [`\${input:mode}`] },
			],
			compounds: [{ name: "Both", configurations: ["Attach", "Task"] }],
		}),
	);
	const profiles = await readFlutterProfiles(root, undefined, {});
	expect(profiles).toHaveLength(4);
	expect(profiles.every((value) => value.profile.diagnostics.length > 0)).toBe(
		true,
	);
});
test("symlinks and traversal cannot execute an entrypoint outside the workspace", async () => {
	const root = await fixture(),
		other = await fixture();
	await symlink(join(other, "lib/main.dart"), join(root, "lib/escaped.dart"));
	await writeFile(
		join(root, ".vscode/launch.json"),
		JSON.stringify({
			configurations: [
				{ name: "Escape", type: "dart", program: "lib/escaped.dart" },
			],
		}),
	);
	expect(
		(await readFlutterProfiles(root, undefined, {}))[0]?.profile.diagnostics,
	).toContain("Path is outside the workspace");
});
test("missing launch.json creates a default and conflicting mode is rejected", async () => {
	const root = await fixture();
	expect(
		(await readFlutterProfiles(root, undefined, {}))[0]?.profile.source,
	).toBe("default");
	await writeFile(
		join(root, ".vscode/launch.json"),
		JSON.stringify({
			configurations: [
				{
					name: "App",
					type: "dart",
					flutterMode: "debug",
					toolArgs: ["--release"],
				},
			],
		}),
	);
	expect(
		(await readFlutterProfiles(root, undefined, {}))[0]?.profile.diagnostics,
	).toContain("flutterMode conflicts with toolArgs");
	expect(() =>
		expandLaunchValue(`\${command:any}`, root, undefined, {}),
	).toThrow("Unresolved variable");
});
