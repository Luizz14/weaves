import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
	delimiter,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	detectLspLanguage,
	type LspServerId,
	type LspServerSettings,
} from "@superset/shared/lsp";

export type LspLaunch = {
	serverId: LspServerId;
	languageId: string;
	rootPath: string;
	command: string | null;
	arguments: string[];
	settings: LspServerSettings;
	env: Record<string, string>;
};

const COMMANDS: Record<LspServerId, { command: string; arguments: string[] }> =
	{
		typescript: {
			command: "typescript-language-server",
			arguments: ["--stdio"],
		},
		dart: { command: "dart", arguments: ["language-server", "--protocol=lsp"] },
		kotlin: { command: "kotlin-lsp", arguments: ["--stdio"] },
		json: { command: "vscode-json-language-server", arguments: ["--stdio"] },
		xml: { command: "lemminx", arguments: [] },
		yaml: { command: "yaml-language-server", arguments: ["--stdio"] },
	};

async function exists(path: string) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

export function ancestorDirectories(
	filePath: string,
	workspaceRoot: string,
): string[] {
	const root = resolve(workspaceRoot);
	const start = dirname(resolve(filePath));
	const rel = relative(root, start);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		return [root];
	const directories: string[] = [];
	for (let current = start; ; current = dirname(current)) {
		directories.push(current);
		if (current === root) return directories;
	}
}

async function findExecutable(
	command: string,
	directories: string[],
): Promise<string | null> {
	const expanded = command.startsWith("~/")
		? join(homedir(), command.slice(2))
		: command;
	const candidates = isAbsolute(expanded)
		? [expanded]
		: directories.map((directory) => join(directory, expanded));
	for (const candidate of candidates) {
		try {
			await access(
				candidate,
				process.platform === "win32" ? constants.F_OK : constants.X_OK,
			);
			if ((await stat(candidate)).isFile()) return candidate;
		} catch {}
	}
	return null;
}

export async function resolveLspLaunch(
	workspaceRoot: string,
	filePath: string,
	settings: LspServerSettings,
	env: Record<string, string>,
): Promise<LspLaunch | null> {
	const language = detectLspLanguage(filePath);
	if (!language) return null;
	const { serverId, languageId } = language;
	const directories = ancestorDirectories(filePath, workspaceRoot);
	let rootPath = resolve(workspaceRoot);
	if (serverId === "dart") {
		for (const directory of directories) {
			const manifest = join(directory, "pubspec.yaml");
			if (!(await exists(manifest))) continue;
			if (rootPath === resolve(workspaceRoot)) rootPath = directory;
			if (/^workspace\s*:/m.test(await readFile(manifest, "utf8"))) {
				rootPath = directory;
				break;
			}
		}
	}
	if (serverId === "kotlin") {
		for (const directory of [...directories].reverse()) {
			if (
				(await exists(join(directory, "settings.gradle"))) ||
				(await exists(join(directory, "settings.gradle.kts")))
			) {
				rootPath = directory;
				break;
			}
		}
	}
	const defaults = COMMANDS[serverId];
	const commandName = settings.command || defaults.command;
	const search = [
		...directories.map((directory) => join(directory, "node_modules", ".bin")),
		...(env.PATH ?? "").split(delimiter).filter(Boolean),
	];
	let command = await findExecutable(commandName, search);
	if (serverId === "dart" && !settings.command) {
		const fvmCandidates = directories.map((directory) =>
			join(directory, ".fvm", "flutter_sdk", "bin"),
		);
		const flutter = await findExecutable("flutter", search);
		command = await findExecutable("dart", [
			...fvmCandidates,
			...(flutter ? [dirname(flutter)] : []),
			...search,
		]);
	}
	let arguments_ = settings.arguments.length
		? settings.arguments
		: defaults.arguments;
	if (serverId === "xml" && settings.command.endsWith(".jar")) {
		const jar = settings.command.startsWith("~/")
			? join(homedir(), settings.command.slice(2))
			: settings.command;
		command = (await exists(jar))
			? await findExecutable("java", [
					...(env.JAVA_HOME ? [join(env.JAVA_HOME, "bin")] : []),
					...search,
				])
			: null;
		arguments_ = ["-jar", jar, ...settings.arguments];
	}
	return {
		serverId,
		languageId,
		rootPath,
		command,
		arguments: arguments_,
		settings,
		env,
	};
}
