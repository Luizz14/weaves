import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FlutterLaunchProfile } from "@superset/shared/flutter";
import JSON5 from "json5";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ancestorDirectories } from "../lsp/adapters";

export interface ResolvedFlutterProfile {
	profile: FlutterLaunchProfile;
	cwd: string;
	program: string;
	args: string[];
	toolArgs: string[];
	env: Record<string, string>;
	noDebug: boolean;
}
export function within(root: string, path: string) {
	const value = relative(resolve(root), resolve(path));
	return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
async function text(path: string, limit = 512 * 1024) {
	if ((await stat(path)).size > limit)
		throw new Error("Configuration exceeds size limit");
	return readFile(path, "utf8");
}
export function expandLaunchValue(
	value: string,
	folder: string,
	activeFile: string | undefined,
	env: Record<string, string>,
) {
	return value.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
		const file = activeFile;
		const values: Record<string, string | undefined> = {
			workspaceFolder: folder,
			workspaceRoot: folder,
			workspaceFolderBasename: folder.split(/[\\/]/).at(-1),
			file,
			fileDirname: file ? dirname(file) : undefined,
			fileBasename: file ? file.split(/[\\/]/).at(-1) : undefined,
			fileBasenameNoExtension: file
				? file
						.split(/[\\/]/)
						.at(-1)
						?.replace(/\.[^.]+$/, "")
				: undefined,
			relativeFile: file ? relative(folder, file) : undefined,
			pathSeparator: sep,
		};
		const result = key.startsWith("env:") ? env[key.slice(4)] : values[key];
		if (result === undefined) throw new Error(`Unresolved variable: ${key}`);
		return result;
	});
}
export function parseEnvFile(raw: string) {
	const env: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		let value = match[2] ?? "";
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		else value = value.replace(/\s+#.*$/, "");
		env[match[1] ?? ""] = value;
	}
	return env;
}
export async function isFlutterRoot(path: string) {
	try {
		const manifest = z
			.object({ dependencies: z.record(z.string(), z.unknown()).optional() })
			.parse(parseYaml(await text(join(path, "pubspec.yaml"))));
		return z
			.object({ sdk: z.literal("flutter") })
			.safeParse(manifest.dependencies?.flutter).success;
	} catch {
		return false;
	}
}
async function checkedPath(root: string, path: string) {
	if (
		!within(root, path) ||
		!within(await realpath(root), await realpath(path))
	)
		throw new Error("Path is outside the workspace");
	return path;
}
export async function readFlutterProfiles(
	root: string,
	activeFile: string | undefined,
	hostEnv: Record<string, string>,
): Promise<ResolvedFlutterProfile[]> {
	if (activeFile && !within(root, activeFile)) activeFile = undefined;
	const folders = new Set([root]);
	if (activeFile)
		for (const folder of ancestorDirectories(activeFile, root))
			if (await isFlutterRoot(folder)) folders.add(folder);
	const records: Array<{
		source: string;
		folder: string;
		raw: string;
		config: unknown;
		index: number;
	}> = [];
	for (const folder of folders) {
		const source = join(folder, ".vscode", "launch.json");
		let raw: string;
		try {
			raw = await text(source);
		} catch (error) {
			if (Reflect.get(Object(error), "code") === "ENOENT") continue;
			raw = "";
			records.push({
				source,
				folder,
				raw,
				config: { name: "launch.json", invalid: String(error) },
				index: -1,
			});
			continue;
		}
		try {
			const parsed = z
				.object({
					configurations: z.array(z.unknown()).default([]),
					compounds: z.array(z.unknown()).default([]),
				})
				.parse(JSON5.parse(raw));
			for (const compound of parsed.compounds)
				records.push({
					source,
					folder,
					raw,
					config: {
						...Object(compound),
						invalid: "Compound configurations are not supported",
					},
					index: -2 - records.length,
				});
			parsed.configurations.forEach((config, index) => {
				records.push({ source, folder, raw, config, index });
			});
		} catch {
			records.push({
				source,
				folder,
				raw,
				config: { name: "launch.json", invalid: "Invalid launch.json" },
				index: -1,
			});
		}
	}
	if (!records.length)
		for (const folder of [root, join(root, "example")]) {
			if (!(await isFlutterRoot(folder))) continue;
			try {
				await stat(join(folder, "lib", "main.dart"));
			} catch {
				continue;
			}
			records.push({
				source: "default",
				folder,
				raw: "",
				config: {
					name: `Flutter (${relative(root, folder) || "."})`,
					type: "dart",
					request: "launch",
					cwd: folder,
					program: "lib/main.dart",
				},
				index: records.length,
			});
		}
	return Promise.all(
		records.map(async (record) => {
			const diagnostics: string[] = [];
			const object = z.record(z.string(), z.unknown()).safeParse(record.config);
			const config = object.success ? object.data : {};
			const profile: FlutterLaunchProfile = {
				id: `${record.source === "default" ? "default" : relative(root, record.source)}:${record.index}`,
				name:
					typeof config.name === "string"
						? config.name
						: "Unnamed configuration",
				source:
					record.source === "default"
						? "default"
						: relative(root, record.source),
				hash: "",
				mode: "debug",
				diagnostics,
			};
			let cwd = record.folder,
				program = join(cwd, "lib", "main.dart"),
				args: string[] = [],
				toolArgs: string[] = [],
				env = { ...hostEnv },
				envRaw = "";
			try {
				if (config.noDebug !== undefined) z.boolean().parse(config.noDebug);
				if (config.invalid) throw new Error(String(config.invalid));
				if (config.type !== "dart")
					throw new Error(
						"Only Flutter configurations with type dart are supported",
					);
				if (config.request !== undefined && config.request !== "launch")
					throw new Error("Attach is not supported");
				for (const key of [
					"preLaunchTask",
					"postDebugTask",
					"customTool",
					"customToolReplacesArgs",
					"runTestsOnDevice",
					"vmAdditionalArgs",
				])
					if (
						config[key] !== undefined &&
						config[key] !== null &&
						config[key] !== false
					)
						throw new Error(`Unsupported launch field: ${key}`);
				if (config.console !== undefined && config.console !== "debugConsole")
					throw new Error("Only debugConsole is supported");
				const expand = (value: string) =>
					expandLaunchValue(value, record.folder, activeFile, hostEnv);
				if (config.cwd !== undefined)
					cwd = resolve(record.folder, expand(z.string().parse(config.cwd)));
				if (config.program !== undefined)
					program = resolve(cwd, expand(z.string().parse(config.program)));
				else program = join(cwd, "lib", "main.dart");
				if (config.cwd === undefined)
					for (const parent of ancestorDirectories(program, root))
						if (await isFlutterRoot(parent)) {
							cwd = parent;
							break;
						}
				await checkedPath(root, cwd);
				await checkedPath(root, program);
				if (!(await isFlutterRoot(cwd)))
					throw new Error("Configuration is not a Flutter application");
				if (!program.endsWith(".dart") || program.endsWith("_test.dart"))
					throw new Error(
						"Flutter application entrypoint required; tests are not supported",
					);
				profile.mode = z
					.enum(["debug", "profile", "release"])
					.parse(config.flutterMode ?? "debug");
				profile.deviceId =
					config.deviceId === undefined
						? undefined
						: expand(z.string().parse(config.deviceId));
				args = z
					.array(z.string())
					.parse(config.args ?? [])
					.map(expand);
				toolArgs = z
					.array(z.string())
					.parse(config.toolArgs ?? [])
					.map(expand);
				const modes = toolArgs.filter((arg) =>
					["--debug", "--profile", "--release"].includes(arg),
				);
				if (modes.length > 1)
					throw new Error("Conflicting Flutter modes in toolArgs");
				if (modes[0]) {
					const mode = modes[0].slice(2) as FlutterLaunchProfile["mode"];
					if (config.flutterMode !== undefined && mode !== profile.mode)
						throw new Error("flutterMode conflicts with toolArgs");
					profile.mode = mode;
				}
				for (let index = 0; index < toolArgs.length; index++) {
					const arg = toolArgs[index];
					const device =
						arg === "-d" || arg === "--device-id"
							? toolArgs[++index]
							: arg?.startsWith("--device-id=")
								? arg.slice(12)
								: undefined;
					if (device) {
						if (profile.deviceId && profile.deviceId !== device)
							throw new Error("deviceId conflicts with toolArgs");
						profile.deviceId = device;
					}
				}
				if (config.envFile !== undefined) {
					const file = await checkedPath(
						root,
						resolve(record.folder, expand(z.string().parse(config.envFile))),
					);
					envRaw = await text(file, 256 * 1024);
					env = { ...env, ...parseEnvFile(envRaw) };
				}
				const additional = z
					.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
					.parse(config.env ?? {});
				for (const [key, value] of Object.entries(additional))
					env[key] = expand(String(value));
			} catch (error) {
				diagnostics.push(
					error instanceof Error ? error.message : "Invalid configuration",
				);
			}
			profile.hash = createHash("sha256")
				.update(record.raw + JSON.stringify(record.config) + envRaw)
				.digest("hex");
			return {
				profile,
				cwd,
				program,
				args,
				toolArgs,
				env,
				noDebug: config.noDebug === true,
			};
		}),
	);
}
