import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import {
	basename,
	delimiter,
	isAbsolute,
	join,
	relative,
	sep,
} from "node:path";
import { FORMATTERS } from "@superset/shared/editor-settings";
import { z } from "zod";
import { ancestorDirectories, resolveLspLaunch } from "../lsp/adapters";
import { readLspSettings } from "../lsp/settings";
import { treeKillWithEscalation } from "../ports/tree-kill";
import { getTerminalBaseEnv, waitForTerminalBaseEnv } from "../terminal/env";
import { protectedProcedure, router } from "../trpc";

export const formatInputSchema = z.object({
	workspaceId: z.string(),
	absolutePath: z.string().max(4096),
	content: z.string().max(10 * 1024 * 1024),
	formatter: z.enum(FORMATTERS),
});
type Formatter = "biome" | "prettier" | "dart";
const BIOME_EXTENSIONS = new Set([
	"js",
	"jsx",
	"ts",
	"tsx",
	"mjs",
	"cjs",
	"mts",
	"cts",
	"json",
	"jsonc",
	"css",
	"graphql",
	"gql",
]);
const PRETTIER_EXTENSIONS = new Set([
	...BIOME_EXTENSIONS,
	"yaml",
	"yml",
	"md",
	"mdx",
	"html",
	"scss",
	"less",
	"xml",
	"vue",
	"svelte",
	"astro",
]);
async function exists(path: string) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

export async function detectProjectFormatter(
	directories: string[],
	extension: string,
	available: (tool: Formatter) => Promise<boolean> = async () => true,
): Promise<Formatter | null> {
	if (extension === "dart") return (await available("dart")) ? "dart" : null;
	if (BIOME_EXTENSIONS.has(extension) && (await available("biome")))
		for (const directory of directories)
			if (
				(await exists(join(directory, "biome.json"))) ||
				(await exists(join(directory, "biome.jsonc")))
			)
				return "biome";
	if (PRETTIER_EXTENSIONS.has(extension) && (await available("prettier")))
		for (const directory of directories) {
			for (const name of [
				".prettierrc",
				".prettierrc.json",
				".prettierrc.yaml",
				".prettierrc.yml",
				".prettierrc.js",
				".prettierrc.cjs",
				".prettierrc.mjs",
				".prettierrc.toml",
				"prettier.config.js",
				"prettier.config.cjs",
				"prettier.config.mjs",
				"prettier.config.ts",
			])
				if (await exists(join(directory, name))) return "prettier";
			try {
				const value = z
					.object({ prettier: z.unknown().optional() })
					.parse(
						JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
					);
				if (value.prettier !== undefined) return "prettier";
			} catch {}
		}
	return null;
}

export async function findProjectTool(
	tool: Formatter,
	directories: string[],
	env: Record<string, string>,
): Promise<string | null> {
	for (const directory of [
		...directories.map((path) => join(path, "node_modules", ".bin")),
		...(env.PATH ?? "").split(delimiter),
	]) {
		const path = join(directory, tool);
		try {
			await access(path, constants.X_OK);
			if ((await stat(path)).isFile()) return path;
		} catch {}
	}
	return null;
}

export function formatWithProcess(
	command: string,
	args: string[],
	cwd: string,
	env: Record<string, string>,
	content: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			shell: false,
			stdio: "pipe",
		});
		let output = "";
		let error = "";
		let size = 0;
		let settled = false;
		const finish = (failure?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (failure) reject(failure);
			else resolve(output);
		};
		const terminate = (failure: Error) => {
			finish(failure);
			if (child.pid)
				void treeKillWithEscalation({
					pid: child.pid,
					escalationTimeoutMs: 500,
				});
		};
		const timer = setTimeout(
			() => terminate(new Error("Formatter timed out")),
			10_000,
		);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			size += Buffer.byteLength(chunk);
			if (size > 16 * 1024 * 1024)
				terminate(new Error("Formatter output exceeds limit"));
			else output += chunk;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			error = `${error}${chunk}`.slice(-4096);
		});
		child.on("error", finish);
		child.stdin.on("error", finish);
		child.on("close", (code) =>
			finish(code === 0 ? undefined : new Error(error || "Formatter failed")),
		);
		child.stdin.end(content);
	});
}

export const editorRouter = router({
	format: protectedProcedure
		.input(formatInputSchema)
		.mutation(async ({ ctx, input }) => {
			if (input.formatter === "none") return { kind: "none" as const };
			const root = ctx.runtime.filesystem.resolveWorkspaceRoot(
				input.workspaceId,
			);
			const rel = relative(root, input.absolutePath);
			if (
				!isAbsolute(input.absolutePath) ||
				rel === ".." ||
				rel.startsWith(`..${sep}`) ||
				isAbsolute(rel)
			)
				return { kind: "lsp" as const };
			await waitForTerminalBaseEnv();
			const env = getTerminalBaseEnv();
			const directories = ancestorDirectories(input.absolutePath, root);
			const extension =
				input.absolutePath.split(".").at(-1)?.toLowerCase() ?? "";
			const tool =
				input.formatter === "auto"
					? await detectProjectFormatter(
							directories,
							extension,
							async (tool) =>
								tool === "dart"
									? true
									: !!(await findProjectTool(tool, directories, env)),
						)
					: input.formatter;
			if (!tool || tool === "lsp") return { kind: "lsp" as const };
			try {
				let command = await findProjectTool(tool, directories, env);
				if (tool === "dart") {
					const server = readLspSettings(ctx.db).servers.dart;
					command =
						(
							await resolveLspLaunch(
								root,
								input.absolutePath,
								{
									...server,
									command: ["dart", "dart.exe"].includes(
										basename(server.command),
									)
										? server.command
										: "",
								},
								env,
							)
						)?.command ?? null;
				}
				if (!command)
					return {
						kind: "warning" as const,
						reason: "missing-tool" as const,
						tool,
					};
				if (
					(tool === "biome" && !BIOME_EXTENSIONS.has(extension)) ||
					(tool === "prettier" && !PRETTIER_EXTENSIONS.has(extension)) ||
					(tool === "dart" && extension !== "dart")
				)
					return {
						kind: "warning" as const,
						reason: "unsupported-file" as const,
						tool,
					};
				const args =
					tool === "biome"
						? ["format", `--stdin-file-path=${input.absolutePath}`]
						: tool === "prettier"
							? ["--stdin-filepath", input.absolutePath]
							: [
									"format",
									"--output=show",
									`--stdin-name=${input.absolutePath}`,
								];
				return {
					kind: "formatted" as const,
					content: await formatWithProcess(
						command,
						args,
						root,
						env,
						input.content,
					),
					tool,
				};
			} catch (error) {
				console.error("[editor] Formatter failed", error);
				return {
					kind: "warning" as const,
					reason: "format-failed" as const,
					tool,
				};
			}
		}),
});
