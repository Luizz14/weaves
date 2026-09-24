#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

type Options = {
	app?: string;
	arch?: string;
	output: string;
	version?: string;
};

function parseArgs(argv: string[]): Options {
	const options: Options = { output: resolve("release") };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--app") options.app = argv[++index];
		else if (arg === "--arch") options.arch = argv[++index];
		else if (arg === "--output") options.output = resolve(argv[++index]);
		else if (arg === "--version") options.version = argv[++index];
		else throw new Error(`Unknown option: ${arg}`);
	}
	return options;
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

const options = parseArgs(process.argv.slice(2));
const app = resolve(required(options.app, "--app"));
const version = required(options.version, "--version");
const arch = required(options.arch, "--arch");
if (!existsSync(app)) throw new Error(`Tauri app bundle not found: ${app}`);

const output = resolve(options.output);
const zip = join(output, `Superset-${version}-${arch}-mac.zip`);
execFileSync("ditto", [
	"-c",
	"-k",
	"--sequesterRsrc",
	"--keepParent",
	app,
	zip,
]);

const digest = createHash("sha512").update(readFileSync(zip)).digest("base64");
const manifest = {
	version,
	files: [{ url: basename(zip), sha512: digest, size: statSync(zip).size }],
	path: basename(zip),
	sha512: digest,
	releaseDate: new Date().toISOString(),
};
const manifestPath = join(output, `Superset-${version}-${arch}-mac.yml`);
const yaml = [
	`version: ${manifest.version}`,
	"files:",
	...manifest.files.map(
		(file) =>
			`  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}`,
	),
	`path: ${manifest.path}`,
	`sha512: ${manifest.sha512}`,
	`releaseDate: ${manifest.releaseDate}`,
].join("\n");
writeFileSync(manifestPath, `${yaml}\n`);
copyFileSync(manifestPath, join(output, `${arch}-mac.yml`));
console.log(`[tauri] legacy Electron update archive: ${zip}`);
console.log(`[tauri] legacy Electron update manifest: ${manifestPath}`);
