import { open, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const MACH_O_MAGIC = new Set([
	0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
	0xcafebabf, 0xbfbafeca,
]);

export type BinaryMinimum = { path: string; minimum: string };

function versionParts(version: string): number[] {
	if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) {
		throw new Error(`Invalid macOS version: ${version}`);
	}
	return version.split(".").map(Number);
}

function compareVersions(left: string, right: string): number {
	const first = versionParts(left);
	const second = versionParts(right);
	for (let index = 0; index < 3; index++) {
		const difference = (first[index] ?? 0) - (second[index] ?? 0);
		if (difference) return difference;
	}
	return 0;
}

export function parseMacOSMinimums(output: string): string[] {
	const minimums: string[] = [];
	for (const command of output.split(/^Load command \d+\s*$/m)) {
		let minimum: string | undefined;
		if (/^\s*cmd LC_BUILD_VERSION\s*$/m.test(command)) {
			if (!/^\s*platform (?:1|MACOS|macos)\s*$/m.test(command)) continue;
			minimum = command.match(/^\s*minos (\S+)\s*$/m)?.[1];
		} else if (/^\s*cmd LC_VERSION_MIN_MACOSX\s*$/m.test(command)) {
			minimum = command.match(/^\s*version (\S+)\s*$/m)?.[1];
		}
		if (!minimum) continue;
		versionParts(minimum);
		minimums.push(minimum);
	}
	return minimums;
}

export function validateMacOSMinimum(
	declared: string,
	binaries: BinaryMinimum[],
): string {
	versionParts(declared);
	const first = binaries[0];
	if (!first) throw new Error("No macOS binaries were inspected");
	let required = first.minimum;
	const violations: string[] = [];
	for (const binary of binaries) {
		if (compareVersions(binary.minimum, required) > 0)
			required = binary.minimum;
		if (compareVersions(binary.minimum, declared) > 0) {
			violations.push(`${binary.path}: requires macOS ${binary.minimum}`);
		}
	}
	if (violations.length) {
		throw new Error(
			`Bundle declares macOS ${declared}, below its native requirements:\n${violations.join("\n")}`,
		);
	}
	return required;
}

async function commandOutput(command: string[]): Promise<string> {
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`${command[0]} failed: ${stderr.trim()}`);
	return stdout.trim();
}

async function* nativeCandidates(directory: string): AsyncGenerator<string> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* nativeCandidates(path);
		} else if (
			entry.isFile() &&
			["", ".node", ".dylib"].includes(extname(path))
		) {
			yield path;
		}
	}
}

async function isMachO(path: string): Promise<boolean> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(4);
		const { bytesRead } = await handle.read(buffer, 0, 4, 0);
		return bytesRead === 4 && MACH_O_MAGIC.has(buffer.readUInt32BE());
	} finally {
		await handle.close();
	}
}

export async function verifyMacOSBundle(bundlePath: string) {
	const bundle = resolve(bundlePath);
	const declared = await commandOutput([
		"/usr/bin/plutil",
		"-extract",
		"LSMinimumSystemVersion",
		"raw",
		"-o",
		"-",
		join(bundle, "Contents/Info.plist"),
	]);
	const binaries: BinaryMinimum[] = [];
	for await (const path of nativeCandidates(join(bundle, "Contents"))) {
		if (!(await isMachO(path))) continue;
		const minimums = parseMacOSMinimums(
			await commandOutput(["otool", "-m", "-l", path]),
		);
		if (!minimums.length)
			throw new Error(`Missing macOS load command: ${path}`);
		for (const minimum of minimums) {
			binaries.push({ path: relative(bundle, path), minimum });
		}
	}
	const required = validateMacOSMinimum(declared, binaries);
	return { declared, required, binarySlices: binaries.length };
}

if (import.meta.main) {
	const bundle = process.argv[2];
	if (!bundle) throw new Error("Usage: verify-macos-runtime.ts <app-bundle>");
	console.log(JSON.stringify(await verifyMacOSBundle(bundle)));
}
