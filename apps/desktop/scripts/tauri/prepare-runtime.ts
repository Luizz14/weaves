import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import runtime from "../../src-tauri/runtime.json";

const desktopDirectory = fileURLToPath(new URL("../../", import.meta.url));
export const runtimeDirectory = resolve(
	desktopDirectory,
	"../../.cache/tauri-runtime/source",
);

const DIFF_ARGUMENTS = [
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
];

async function git(directory: string, args: string[]): Promise<string> {
	const process = Bun.spawn(["git", "-C", directory, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [output, error, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${error.trim()}`);
	return output.trimEnd();
}

export async function applyRuntimePatch({
	directory,
	revision,
	patchPath,
}: {
	directory: string;
	revision: string;
	patchPath: string;
}): Promise<void> {
	const actualRevision = await git(directory, ["rev-parse", "HEAD"]);
	if (actualRevision !== revision) {
		throw new Error(
			`Tauri revision mismatch: expected ${revision}, got ${actualRevision}`,
		);
	}
	const patch = (await readFile(patchPath, "utf8")).trimEnd();
	const changes = await git(directory, DIFF_ARGUMENTS);
	if (changes === patch) {
		await git(directory, ["apply", "--reverse", "--check", patchPath]);
		return;
	}
	if (changes.length !== 0) {
		throw new Error(
			"Cached Tauri source contains changes outside the pinned patch",
		);
	}
	await git(directory, ["apply", "--check", patchPath]);
	await git(directory, ["apply", patchPath]);
	const applied = await git(directory, DIFF_ARGUMENTS);
	if (applied !== patch)
		throw new Error("Applied Tauri patch differs from the reviewed patch");
}

export async function prepareRuntime(): Promise<string> {
	if (!existsSync(runtimeDirectory)) {
		await mkdir(dirname(runtimeDirectory), { recursive: true });
		const clone = Bun.spawn(
			[
				"git",
				"clone",
				"--depth",
				"1",
				"--single-branch",
				"--branch",
				runtime.tag,
				runtime.repository,
				runtimeDirectory,
			],
			{ stdout: "inherit", stderr: "inherit" },
		);
		if ((await clone.exited) !== 0)
			throw new Error("Unable to fetch the pinned Tauri runtime");
	}
	await applyRuntimePatch({
		directory: runtimeDirectory,
		revision: runtime.revision,
		patchPath: resolve(
			desktopDirectory,
			"src-tauri/patches/cef-popup-disposition.patch",
		),
	});
	return runtimeDirectory;
}

if (import.meta.main) {
	console.log(await prepareRuntime());
}
