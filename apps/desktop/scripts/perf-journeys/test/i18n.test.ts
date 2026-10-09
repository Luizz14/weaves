import { describe, expect, test } from "bun:test";
import { loadTranslator, parsePo } from "../lib/i18n";

describe("parsePo", () => {
	test("reads contexts, multi-line strings and falls back on empty translations", () => {
		const entries = parsePo(
			[
				'msgid ""',
				'msgstr ""',
				'"Language: pt_BR\\n"',
				"",
				'msgctxt "job application"',
				'msgid "Apply"',
				'msgstr "Candidatar-se"',
				"",
				'msgid "Apply"',
				'msgstr "Aplicar"',
				"",
				'msgid ""',
				'"Long "',
				'"message"',
				'msgstr ""',
				'"Mensagem "',
				'"longa"',
				"",
				'msgid "Untranslated"',
				'msgstr ""',
			].join("\n"),
		);
		expect(entries.get("job application\u0004Apply")).toBe("Candidatar-se");
		expect(entries.get("Apply")).toBe("Aplicar");
		expect(entries.get("Long message")).toBe("Mensagem longa");
		expect(entries.get("Untranslated")).toBe("Untranslated");
	});

	test("loads the real pt-BR catalog", () => {
		const tr = loadTranslator("pt-BR");
		expect(tr.locale).toBe("pt-BR");
		expect(tr.t("Close terminal")).toBe("Fechar terminal");
		expect(loadTranslator("en").t("Close terminal")).toBe("Close terminal");
	});
});
