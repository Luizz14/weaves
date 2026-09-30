import { describe, expect, test } from "bun:test";
import {
	detectLspLanguage,
	filePathToLspUri,
	lspSettingsSchema,
	lspUriToFilePath,
} from "./lsp";

describe("LSP identities", () => {
	test("keeps JSX/TSX IDs separate and recognizes the six language families", () => {
		expect(detectLspLanguage("/app/view.tsx")?.languageId).toBe(
			"typescriptreact",
		);
		expect(detectLspLanguage("C:\\app\\view.jsx")?.languageId).toBe(
			"javascriptreact",
		);
		for (const extension of [
			"ts",
			"js",
			"dart",
			"kt",
			"kts",
			"json",
			"jsonc",
			"xml",
			"yml",
			"yaml",
		])
			expect(detectLspLanguage(`/app/a.${extension}`)).not.toBeNull();
		expect(detectLspLanguage("/app/a.png")).toBeNull();
	});
	test("round-trips paths with spaces, Unicode, percent and URI delimiters", () => {
		for (const path of [
			"/workspace/ação #100%.dart",
			"C:/Users/test/a file.ts",
		])
			expect(lspUriToFilePath(filePathToLspUri(path))).toBe(path);
		expect(lspUriToFilePath("https://example.com/a.ts")).toBeNull();
		expect(lspUriToFilePath("file://remote-host/a.ts")).toBeNull();
	});
	test("enables installed tools by default and rejects malformed command settings", () => {
		const settings = lspSettingsSchema.parse({});
		expect(
			Object.values(settings.servers).every(
				(server) => server.enabled && server.command === "",
			),
		).toBe(true);
		expect(
			lspSettingsSchema.safeParse({
				servers: { dart: { arguments: "--stdio" } },
			}).success,
		).toBe(false);
	});
});
