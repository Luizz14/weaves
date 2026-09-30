import { z } from "zod";

export const LSP_SERVER_IDS = [
	"typescript",
	"dart",
	"kotlin",
	"json",
	"xml",
	"yaml",
] as const;
export type LspServerId = (typeof LSP_SERVER_IDS)[number];

export const lspServerSettingsSchema = z.object({
	enabled: z.boolean().default(true),
	command: z.string().trim().max(4096).default(""),
	arguments: z.array(z.string().max(4096)).max(64).default([]),
	initializationOptions: z.record(z.string(), z.unknown()).default({}),
	configuration: z.record(z.string(), z.unknown()).default({}),
});
export const lspSettingsSchema = z.object({
	servers: z
		.object({
			typescript: lspServerSettingsSchema.default(() =>
				lspServerSettingsSchema.parse({}),
			),
			dart: lspServerSettingsSchema.default(() =>
				lspServerSettingsSchema.parse({}),
			),
			kotlin: lspServerSettingsSchema.default(() =>
				lspServerSettingsSchema.parse({}),
			),
			json: lspServerSettingsSchema.default(() =>
				lspServerSettingsSchema.parse({}),
			),
			xml: lspServerSettingsSchema.default(() =>
				lspServerSettingsSchema.parse({}),
			),
			yaml: lspServerSettingsSchema.default(() =>
				lspServerSettingsSchema.parse({}),
			),
		})
		.default(() => ({
			typescript: lspServerSettingsSchema.parse({}),
			dart: lspServerSettingsSchema.parse({}),
			kotlin: lspServerSettingsSchema.parse({}),
			json: lspServerSettingsSchema.parse({}),
			xml: lspServerSettingsSchema.parse({}),
			yaml: lspServerSettingsSchema.parse({}),
		})),
});
export type LspSettings = z.infer<typeof lspSettingsSchema>;
export type LspServerSettings = z.infer<typeof lspServerSettingsSchema>;
export type LspState =
	| "disabled"
	| "missing"
	| "starting"
	| "running"
	| "stopped"
	| "failed";

export const LSP_SERVER_LABELS: Record<LspServerId, string> = {
	typescript: "TypeScript / JavaScript",
	dart: "Dart / Flutter",
	kotlin: "Kotlin",
	json: "JSON / JSONC",
	xml: "XML",
	yaml: "YAML",
};
export const LSP_INSTALL_INSTRUCTIONS: Record<LspServerId, string> = {
	typescript: "npm install -g typescript-language-server typescript",
	dart: "https://docs.flutter.dev/install",
	kotlin: "https://github.com/Kotlin/kotlin-lsp#install-kotlin-lsp-cli",
	json: "npm install -g vscode-langservers-extracted",
	xml: "https://github.com/eclipse-lemminx/lemminx",
	yaml: "npm install -g yaml-language-server",
};

const LANGUAGE_IDS: Record<
	string,
	{ serverId: LspServerId; languageId: string }
> = {
	ts: { serverId: "typescript", languageId: "typescript" },
	tsx: { serverId: "typescript", languageId: "typescriptreact" },
	js: { serverId: "typescript", languageId: "javascript" },
	jsx: { serverId: "typescript", languageId: "javascriptreact" },
	mjs: { serverId: "typescript", languageId: "javascript" },
	cjs: { serverId: "typescript", languageId: "javascript" },
	mts: { serverId: "typescript", languageId: "typescript" },
	cts: { serverId: "typescript", languageId: "typescript" },
	dart: { serverId: "dart", languageId: "dart" },
	kt: { serverId: "kotlin", languageId: "kotlin" },
	kts: { serverId: "kotlin", languageId: "kotlin" },
	json: { serverId: "json", languageId: "json" },
	jsonc: { serverId: "json", languageId: "jsonc" },
	xml: { serverId: "xml", languageId: "xml" },
	xsd: { serverId: "xml", languageId: "xml" },
	xsl: { serverId: "xml", languageId: "xml" },
	yaml: { serverId: "yaml", languageId: "yaml" },
	yml: { serverId: "yaml", languageId: "yaml" },
};

export function detectLspLanguage(filePath: string) {
	const extension =
		filePath.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
	return LANGUAGE_IDS[extension] ?? null;
}

export function filePathToLspUri(filePath: string): string {
	const path = filePath.replaceAll("\\", "/");
	const absolute = path.startsWith("/") ? path : `/${path}`;
	return `file://${absolute
		.split("/")
		.map((segment) => encodeURIComponent(segment).replaceAll("%3A", ":"))
		.join("/")}`;
}

export function lspUriToFilePath(uri: string): string | null {
	try {
		const url = new URL(uri);
		if (
			url.protocol !== "file:" ||
			(url.hostname && url.hostname !== "localhost")
		)
			return null;
		const path = decodeURIComponent(url.pathname);
		return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
	} catch {
		return null;
	}
}
