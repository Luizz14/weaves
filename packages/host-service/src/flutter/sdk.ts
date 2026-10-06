import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { ancestorDirectories } from "../lsp/adapters";

async function executable(path: string) {
	try {
		await access(path, constants.X_OK);
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
export async function resolveFlutterSdk(
	root: string,
	program: string,
	env: Record<string, string>,
	dartCommand = "",
) {
	const suffix = process.platform === "win32" ? ".bat" : "";
	const candidates: string[] = [];
	if (["dart", "dart.exe", "dart.bat"].includes(basename(dartCommand))) {
		let command: string | undefined;
		for (const candidate of dartCommand.includes("/") ||
		dartCommand.includes("\\")
			? [dartCommand]
			: (env.PATH ?? "")
					.split(delimiter)
					.map((path) => join(path, dartCommand))) {
			if (await executable(candidate)) {
				command = candidate;
				break;
			}
		}
		if (command) {
			candidates.push(
				join(dirname(command), `flutter${suffix}`),
				join(
					resolve(dirname(command), "../../../.."),
					"bin",
					`flutter${suffix}`,
				),
			);
		}
	}
	candidates.push(
		...ancestorDirectories(program, root).map((path) =>
			join(path, ".fvm", "flutter_sdk", "bin", `flutter${suffix}`),
		),
		...(env.PATH ?? "")
			.split(delimiter)
			.filter(Boolean)
			.map((path) => join(path, `flutter${suffix}`)),
	);
	for (const flutter of candidates) {
		if (!(await executable(flutter))) continue;
		const sdkRoot = dirname(dirname(flutter));
		const dartNative = join(
			sdkRoot,
			"bin",
			"cache",
			"dart-sdk",
			"bin",
			process.platform === "win32" ? "dart.exe" : "dart",
		);
		const dart = (await executable(dartNative))
			? dartNative
			: join(sdkRoot, "bin", `dart${suffix}`);
		if (await executable(dart)) return { flutter, dart };
	}
	throw new Error("Flutter SDK not found in configured SDK, FVM or PATH");
}
