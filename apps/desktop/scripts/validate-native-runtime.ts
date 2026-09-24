/**
 * Validate the files Vite and the Tauri sidecar packager must provide.
 *
 * This is intentionally a packaging guard, not a substitute for launching the
 * real signed CEF application. It catches a missing Node sidecar, an accidental
 * Electron external, a symlink escaping the bundle, and missing native .node
 * bindings before a release artifact is produced.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import ts from "typescript";
import {
	DESKTOP_SERVICE_ENTRY,
	NODE_RUNTIME_VERSION,
	RUNTIME_NODE_MODULES_DIRECTORY,
	runtimeModuleNames,
} from "../runtime-dependencies";

const projectRoot = join(import.meta.dirname, "..");
const distRoot = join(projectRoot, "dist");
const distMain = join(distRoot, "main");
const distNodeModules = join(distRoot, RUNTIME_NODE_MODULES_DIRECTORY);
const runtimeNode = join(distRoot, "node", "bin", "node");

const allowedBareRequires = new Set([
	...builtinModules,
	...builtinModules
		.filter((specifier) => !specifier.startsWith("node:"))
		.map((specifier) => `node:${specifier}`),
	...runtimeModuleNames,
	"pg-native",
]);

function fail(message: string): never {
	console.error(`[validate:native-runtime] ${message}`);
	process.exit(1);
}

function assertExists(path: string, reason: string): void {
	if (!existsSync(path)) fail(`${reason}\nMissing path: ${path}`);
}

function collectFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...collectFiles(path));
		else files.push(path);
	}
	return files;
}

function packageName(specifier: string): string {
	if (specifier.startsWith("@")) {
		const [scope, name] = specifier.split("/");
		return `${scope}/${name}`;
	}
	return specifier.split("/")[0] ?? specifier;
}

function collectBareRequires(filePath: string): string[] {
	const source = ts.createSourceFile(
		filePath,
		readFileSync(filePath, "utf8"),
		ts.ScriptTarget.Latest,
		false,
		ts.ScriptKind.JS,
	);
	const specifiers: string[] = [];
	function visit(node: ts.Node): void {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "require" &&
			node.arguments.length === 1
		) {
			const [argument] = node.arguments;
			if (argument && ts.isStringLiteralLike(argument))
				specifiers.push(argument.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return specifiers.filter(
		(specifier) => !specifier.startsWith(".") && !specifier.startsWith("/"),
	);
}

function validateBundleEntries(): void {
	assertExists(
		join(distMain, DESKTOP_SERVICE_ENTRY.replace(/^main\//, "")),
		"Node desktop-service entry is missing. Run `bun run compile:app` first.",
	);
	for (const entry of [
		"terminal-host.cjs",
		"pty-subprocess.cjs",
		"git-task-worker.cjs",
		"host-service.cjs",
		"pty-daemon.cjs",
		"host-worker.cjs",
	]) {
		assertExists(
			join(distMain, entry),
			`Node worker entry ${entry} is missing.`,
		);
	}

	const files = collectFiles(distMain).filter((path) => path.endsWith(".cjs"));
	if (files.length === 0)
		fail("No CommonJS Node sidecar output was generated.");

	for (const file of files) {
		const content = readFileSync(file, "utf8");
		if (/require\(["']electron(["']|\/)/.test(content)) {
			fail(`Electron runtime import remains in Node sidecar output: ${file}`);
		}
		for (const specifier of collectBareRequires(file)) {
			if (allowedBareRequires.has(packageName(specifier))) continue;
			if (allowedBareRequires.has(specifier)) continue;
			fail(
				`Unexpected external require ${specifier} in ${file}. Bundle it or add it to runtime-dependencies.ts.`,
			);
		}
	}
}

function validateNodeSidecar(): void {
	assertExists(runtimeNode, "Node sidecar executable is missing.");
	if (lstatSync(runtimeNode).isSymbolicLink())
		fail(
			`Node sidecar must be copied into the bundle, not a symlink: ${runtimeNode}`,
		);
	let version = "";
	try {
		version = execFileSync(runtimeNode, ["--version"], {
			encoding: "utf8",
		}).trim();
	} catch (error) {
		fail(`Packaged Node executable could not start: ${String(error)}`);
	}
	if (version !== `v${NODE_RUNTIME_VERSION}`)
		fail(
			`Packaged Node version is ${version}; expected v${NODE_RUNTIME_VERSION}.`,
		);
}

function validateRuntimeModules(): void {
	assertExists(
		distNodeModules,
		"The isolated Node sidecar node_modules directory is missing.",
	);
	for (const moduleName of runtimeModuleNames) {
		const modulePath = join(distNodeModules, ...moduleName.split("/"));
		assertExists(modulePath, `Runtime dependency ${moduleName} is missing.`);
		if (lstatSync(modulePath).isSymbolicLink())
			fail(
				`Runtime dependency escapes the bundle through a symlink: ${modulePath}`,
			);
	}
	for (const moduleName of ["better-sqlite3", "node-pty"]) {
		const modulePath = join(distNodeModules, ...moduleName.split("/"));
		const nativeFiles = collectFiles(modulePath).filter((path) =>
			path.endsWith(".node"),
		);
		if (nativeFiles.length === 0)
			fail(`Runtime dependency ${moduleName} has no packaged .node binding.`);
	}
	if (process.platform === "darwin") {
		const keyringPlatformPackage = `@napi-rs/keyring-darwin-${process.arch}`;
		const keyringPlatformPath = join(
			distNodeModules,
			...keyringPlatformPackage.split("/"),
		);
		assertExists(
			keyringPlatformPath,
			`Runtime dependency ${keyringPlatformPackage} is missing.`,
		);
		if (
			!collectFiles(keyringPlatformPath).some((path) => path.endsWith(".node"))
		)
			fail(
				`Runtime dependency ${keyringPlatformPackage} has no packaged .node binding.`,
			);
	}
}

function validateNodeExecutionContract(): void {
	const appEnvironmentChunk = collectFiles(distMain).find((path) => {
		if (!path.endsWith(".cjs")) return false;
		const content = readFileSync(path, "utf8");
		return (
			content.includes("SUPERSET_HOME_DIR") &&
			content.includes("APP_STATE_PATH") &&
			content.includes("homedir")
		);
	});
	if (!appEnvironmentChunk)
		fail("The emitted Node app-environment module could not be located.");

	const wsPackage = join(distNodeModules, "ws");
	const keyringPackage = join(distNodeModules, "@napi-rs", "keyring");
	const expectedHome = join(distRoot, ".runtime-contract-home");
	const probe = [
		"const assert = require('node:assert/strict');",
		"const appEnvironment = require(process.argv[1]);",
		"assert.equal(appEnvironment.SUPERSET_HOME_DIR, process.env.SUPERSET_HOME_DIR);",
		"const ws = require(process.argv[2]);",
		"assert.equal(typeof ws.WebSocketServer, 'function');",
		"const keyring = require(process.argv[3]);",
		"assert.equal(typeof keyring.AsyncEntry, 'function');",
	].join("\n");
	try {
		execFileSync(
			runtimeNode,
			["-e", probe, appEnvironmentChunk, wsPackage, keyringPackage],
			{
				encoding: "utf8",
				env: {
					...process.env,
					SUPERSET_HOME_DIR: expectedHome,
				},
			},
		);
	} catch (error) {
		fail(
			`Packaged Node runtime contract failed (dynamic SUPERSET_HOME_DIR or ws.WebSocketServer): ${String(error)}`,
		);
	}
}

function validateResources(): void {
	for (const resource of [
		"resources/migrations",
		"resources/host-migrations",
		"resources/chat-migrations",
		"resources/bin",
	]) {
		assertExists(
			join(distRoot, resource),
			`Required resource ${resource} is missing.`,
		);
	}
}

validateBundleEntries();
validateNodeSidecar();
validateRuntimeModules();
validateNodeExecutionContract();
validateResources();
console.log("[validate:native-runtime] Node/Tauri runtime layout is valid");
