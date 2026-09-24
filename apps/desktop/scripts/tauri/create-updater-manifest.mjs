#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function option(argv, name) {
	const index = argv.indexOf(name);
	if (index < 0 || !argv[index + 1]) throw new Error(`Missing ${name}`);
	return argv[index + 1];
}

const argv = process.argv.slice(2);
const version = option(argv, "--version");
const artifactsDirectory = resolve(option(argv, "--artifacts-dir"));
const baseUrl = option(argv, "--base-url").replace(/\/$/, "");
const output = resolve(option(argv, "--output"));

const targets = [
	["arm64", "darwin-aarch64"],
	["x64", "darwin-x86_64"],
];
const platforms = {};
for (const [arch, platform] of targets) {
	const archiveName = `Superset-${version}-${arch}.app.tar.gz`;
	const signaturePath = join(artifactsDirectory, `${archiveName}.sig`);
	if (!existsSync(join(artifactsDirectory, archiveName))) {
		throw new Error(`Missing updater archive: ${archiveName}`);
	}
	if (!existsSync(signaturePath)) {
		throw new Error(`Missing updater signature: ${signaturePath}`);
	}
	const signature = readFileSync(signaturePath, "utf8").trim();
	if (!signature) throw new Error(`Empty updater signature: ${signaturePath}`);
	platforms[platform] = {
		signature,
		url: `${baseUrl}/${archiveName}`,
	};
}

writeFileSync(
	output,
	`${JSON.stringify(
		{
			version,
			notes: `Superset ${version}`,
			pub_date: new Date().toISOString(),
			platforms,
		},
		null,
		2,
	)}\n`,
);
console.log(`[tauri] wrote official updater manifest: ${output}`);
