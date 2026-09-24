import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRuntimePatch } from "./prepare-runtime";

const directories: string[] = [];

async function git(directory: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", "-C", directory, ...args]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trimEnd();
}

async function fixture() {
	const directory = await mkdtemp(
		join(tmpdir(), "superset-runtime-patch-test-"),
	);
	directories.push(directory);
	await git(directory, "init", "--quiet");
	await Bun.write(join(directory, "runtime.rs"), "original\n");
	await git(directory, "add", "runtime.rs");
	await git(
		directory,
		"-c",
		"user.name=Runtime Test",
		"-c",
		"user.email=runtime@example.invalid",
		"-c",
		"commit.gpgSign=false",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	);
	const revision = await git(directory, "rev-parse", "HEAD");
	await Bun.write(join(directory, "runtime.rs"), "patched\n");
	const patch = await git(
		directory,
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--no-renames",
		"--no-relative",
		"--abbrev=7",
		"--src-prefix=a/",
		"--dst-prefix=b/",
		"HEAD",
	);
	const patchPath = join(directory, "runtime.patch");
	await Bun.write(patchPath, `${patch}\n`);
	await Bun.write(join(directory, "runtime.rs"), "original\n");
	return { directory, revision, patchPath };
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("applies the reviewed patch and accepts an identical second preparation", async () => {
	const input = await fixture();
	await applyRuntimePatch(input);
	await applyRuntimePatch(input);
	expect(await Bun.file(join(input.directory, "runtime.rs")).text()).toBe(
		"patched\n",
	);
});

test("rejects a different upstream revision without changing its files", async () => {
	const input = await fixture();
	await expect(
		applyRuntimePatch({
			...input,
			revision: "0000000000000000000000000000000000000000",
		}),
	).rejects.toThrow("revision mismatch");
	expect(await Bun.file(join(input.directory, "runtime.rs")).text()).toBe(
		"original\n",
	);
});

test("preserves unexpected cached source edits", async () => {
	const input = await fixture();
	await Bun.write(join(input.directory, "runtime.rs"), "unrelated change\n");
	await expect(applyRuntimePatch(input)).rejects.toThrow(
		"outside the pinned patch",
	);
	expect(await Bun.file(join(input.directory, "runtime.rs")).text()).toBe(
		"unrelated change\n",
	);
});

test("patch verification is independent of local Git display preferences", async () => {
	const input = await fixture();
	await git(input.directory, "config", "diff.noprefix", "true");
	await git(input.directory, "config", "core.abbrev", "12");
	await applyRuntimePatch(input);
	await applyRuntimePatch(input);
	expect(await Bun.file(join(input.directory, "runtime.rs")).text()).toBe(
		"patched\n",
	);
});
