import type { Configuration, FileSet } from "electron-builder";
import baseConfig from "./electron-builder";

export const macosArm64Exclusions = [
	"!**/prebuilds/!(darwin-arm64){,/**/*}",
	"!**/node_modules/@ast-grep/napi-!(darwin-arm64){,/**/*}",
	"!**/node_modules/@parcel/watcher-!(darwin-arm64){,/**/*}",
	"!**/node_modules/@napi-rs/keyring-!(darwin-arm64){,/**/*}",
	"!**/node_modules/@anthropic-ai/claude-agent-sdk-!(darwin-arm64){,/**/*}",
	"!**/*.{exe,dll,pdb,ico}",
];

function exclusionsForSource(source: string): string[] {
	return macosArm64Exclusions
		.map((pattern) => pattern.replace(`!**/${source}/`, "!"))
		.filter((pattern) => !pattern.includes("node_modules/"));
}

function withMacosFilters(file: string | FileSet): string | FileSet {
	return typeof file === "string"
		? file
		: {
				...file,
				filter: [
					...[file.filter ?? "**/*"].flat(),
					...exclusionsForSource(file.from ?? "."),
				],
			};
}

const config: Configuration = {
	...baseConfig,
	directories: {
		...baseConfig.directories,
		output: "release-local-macos",
	},
	files: [
		...[baseConfig.files ?? "**/*"].flat().map(withMacosFilters),
		...macosArm64Exclusions,
	],
	extraResources: [baseConfig.extraResources ?? []]
		.flat()
		.map(withMacosFilters),
	mac: {
		...baseConfig.mac,
		target: [
			{ target: "dmg", arch: ["arm64"] },
			{ target: "zip", arch: ["arm64"] },
		],
		notarize: false,
	},
	linux: undefined,
	win: undefined,
	nsis: undefined,
	deb: undefined,
};

export default config;
