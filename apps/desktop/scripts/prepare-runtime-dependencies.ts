/**
 * Stage the private Node sidecar runtime used by the Tauri application.
 *
 * The install is isolated from the workspace. Native modules are rebuilt (or
 * downloaded from their Node 24 prebuild) inside that staging directory, so a
 * packaging run never mutates modules used by the shared development install.
 */

import { execFileSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	NODE_RUNTIME_EXECUTABLE,
	NODE_RUNTIME_VERSION,
	RUNTIME_NODE_MODULES_DIRECTORY,
} from "../runtime-dependencies";

const desktopDirectory = resolve(import.meta.dirname, "..");
const repositoryDirectory = resolve(desktopDirectory, "../..");
const workspaceNodeModules = join(repositoryDirectory, "node_modules");
const desktopNodeModules = join(desktopDirectory, "node_modules");
const distDirectory = join(desktopDirectory, "dist");
const runtimeDirectory = join(distDirectory, "node");
const runtimeNodeModules = join(distDirectory, RUNTIME_NODE_MODULES_DIRECTORY);
const isolatedRuntimeDirectory = join(distDirectory, ".runtime-install");
const isolatedNodeModules = join(isolatedRuntimeDirectory, "node_modules");

const targetPlatform = process.env.TARGET_PLATFORM || process.platform;
const targetArch = process.env.TARGET_ARCH || process.arch;

const runtimeDependencyVersions = {
	"@anthropic-ai/claude-agent-sdk": "0.3.201",
	"@ast-grep/napi": "0.41.1",
	"@napi-rs/keyring": "2.1.0",
	"@parcel/watcher": "2.5.6",
	"better-sqlite3": "12.11.1",
	"native-keymap": "3.3.9",
	"node-addon-api": "7.1.1",
	"node-pty": "1.2.0-beta.14",
	sharp: "0.35.4",
} as const;

function fail(message: string): never {
	throw new Error(`[prepare:runtime] ${message}`);
}

function packagePath(root: string, packageName: string): string {
	return join(root, ...packageName.split("/"));
}

function bunFlatPackagePath(packageName: string): string {
	return packagePath(
		join(workspaceNodeModules, ".bun", "node_modules"),
		packageName,
	);
}

function findBunStorePackage(packageName: string): string | undefined {
	const store = join(workspaceNodeModules, ".bun");
	if (!existsSync(store)) return undefined;
	const prefix = `${packageName.replace("/", "+")}@`;
	const candidate = readdirSync(store)
		.filter((entry) => entry.startsWith(prefix))
		.sort()[0];
	if (!candidate) return undefined;
	const path = packagePath(join(store, candidate, "node_modules"), packageName);
	return existsSync(path) ? path : undefined;
}

function resolveInstalledPackage(packageName: string): string | undefined {
	const candidates = [
		packagePath(desktopNodeModules, packageName),
		packagePath(workspaceNodeModules, packageName),
		bunFlatPackagePath(packageName),
		findBunStorePackage(packageName),
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (existsSync(candidate)) return realpathSync(candidate);
	}
	return undefined;
}

function copyInstalledPackage(
	packageName: string,
	destinationRoot = runtimeNodeModules,
): string {
	const source = resolveInstalledPackage(packageName);
	if (!source) {
		fail(
			`${packageName} is not installed. Run bun install --frozen --ignore-scripts before staging the Node runtime.`,
		);
	}
	const destination = packagePath(destinationRoot, packageName);
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(source, destination, { recursive: true, dereference: true });
	return destination;
}

function locateNodeBinary(): string {
	const configured = process.env.NODE_RUNTIME_BINARY;
	if (configured) return resolve(configured);
	try {
		const command = process.platform === "win32" ? "where.exe" : "which";
		return execFileSync(command, ["node"], { encoding: "utf8" })
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean) as string;
	} catch {
		fail(
			"Node 24.15.0 was not found. Install that exact Node version or set NODE_RUNTIME_BINARY to its executable.",
		);
	}
}

function stageNodeRuntime(): string {
	const source = locateNodeBinary();
	let actualVersion: string;
	try {
		actualVersion = execFileSync(source, ["--version"], {
			encoding: "utf8",
		}).trim();
	} catch (error) {
		fail(`Unable to execute NODE_RUNTIME_BINARY (${source}): ${String(error)}`);
	}
	const expectedVersion = `v${NODE_RUNTIME_VERSION}`;
	if (actualVersion !== expectedVersion) {
		fail(
			`Node sidecar version mismatch: expected ${expectedVersion}, got ${actualVersion}.`,
		);
	}

	const destination = join(runtimeDirectory, "bin", "node");
	mkdirSync(dirname(destination), { recursive: true });
	if (
		!existsSync(destination) ||
		realpathSync(source) !== realpathSync(destination)
	) {
		cpSync(source, destination, { dereference: true });
	}
	chmodSync(destination, 0o755);
	console.log(`[prepare:runtime] staged ${actualVersion} at ${destination}`);
	return destination;
}

function assertNativeBinding(moduleName: string, directory: string): void {
	const files: string[] = [];
	function visit(path: string): void {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) visit(child);
			else if (entry.name.endsWith(".node")) files.push(child);
		}
	}
	visit(directory);
	if (files.length === 0)
		fail(`${moduleName} has no native .node binding in the staged runtime.`);
}

function runNpm(nodeBinary: string, args: string[]): void {
	const npm = process.env.NPM_BINARY ?? "npm";
	const nodeDirectory = dirname(nodeBinary);
	const path = [nodeDirectory, process.env.PATH].filter(Boolean).join(":");
	execFileSync(npm, args, {
		cwd: isolatedRuntimeDirectory,
		stdio: "inherit",
		env: {
			...process.env,
			PATH: path,
		},
	});
}

function stageDependencies(nodeBinary: string): void {
	rmSync(isolatedRuntimeDirectory, { recursive: true, force: true });
	mkdirSync(isolatedRuntimeDirectory, { recursive: true });
	writeFileSync(
		join(isolatedRuntimeDirectory, "package.json"),
		`${JSON.stringify({ private: true, dependencies: runtimeDependencyVersions }, null, 2)}\n`,
	);
	runNpm(nodeBinary, [
		"install",
		"--ignore-scripts",
		"--no-package-lock",
		"--omit=dev",
		"--no-audit",
		"--no-fund",
		"--cpu",
		targetArch,
		"--os",
		targetPlatform,
	]);

	// This package is private to the workspace and therefore cannot come from
	// npm. Copy its source into the isolated tree, then let npm rebuild execute
	// its own install script against the Node 24 ABI.
	copyInstalledPackage("@superset/macos-process-metrics", isolatedNodeModules);
	// Bun applies patches declared in the root lockfile; npm does not. Reuse the
	// patched source tree for node-pty, but rebuild its native helper in this
	// isolated install so the patch and Node 24 ABI are both retained.
	copyInstalledPackage("node-pty", isolatedNodeModules);
	// ws is pure JavaScript and is already pinned by the desktop package. Copy
	// the lockfile-resolved source instead of resolving it again through npm.
	copyInstalledPackage("ws", isolatedNodeModules);
	runNpm(nodeBinary, [
		"rebuild",
		"--no-audit",
		"--no-fund",
		...Object.keys(runtimeDependencyVersions),
		"@superset/macos-process-metrics",
	]);

	rmSync(runtimeNodeModules, { recursive: true, force: true });
	mkdirSync(dirname(runtimeNodeModules), { recursive: true });
	cpSync(isolatedNodeModules, runtimeNodeModules, {
		recursive: true,
		dereference: true,
	});
	rmSync(isolatedRuntimeDirectory, { recursive: true, force: true });
	console.log(
		`[prepare:runtime] staged isolated native dependencies for Node ${NODE_RUNTIME_VERSION}`,
	);
	assertNativeBinding(
		"better-sqlite3",
		packagePath(runtimeNodeModules, "better-sqlite3"),
	);
	assertNativeBinding("node-pty", packagePath(runtimeNodeModules, "node-pty"));
	const keyringPlatformPackage =
		targetPlatform === "darwin"
			? `@napi-rs/keyring-darwin-${targetArch}`
			: undefined;
	if (keyringPlatformPackage) {
		assertNativeBinding(
			keyringPlatformPackage,
			packagePath(runtimeNodeModules, keyringPlatformPackage),
		);
	}
	const sharpPlatformPackage =
		targetPlatform === "darwin"
			? `@img/sharp-darwin-${targetArch}`
			: `@img/sharp-${targetPlatform}-${targetArch}`;
	assertNativeBinding(
		sharpPlatformPackage,
		packagePath(runtimeNodeModules, sharpPlatformPackage),
	);
}

function writeRuntimeMetadata(): void {
	writeFileSync(
		join(runtimeDirectory, "runtime.json"),
		`${JSON.stringify(
			{
				nodeVersion: NODE_RUNTIME_VERSION,
				platform: targetPlatform,
				arch: targetArch,
				nodeExecutable: NODE_RUNTIME_EXECUTABLE,
				nodeModules: "node_modules",
			},
			null,
			2,
		)}\n`,
	);
}

function prepareRuntime(): void {
	console.log(
		`[prepare:runtime] target ${targetPlatform}/${targetArch}; native modules are isolated from the workspace`,
	);
	const nodeBinary = stageNodeRuntime();
	stageDependencies(nodeBinary);
	writeRuntimeMetadata();
}

if (import.meta.main) prepareRuntime();
