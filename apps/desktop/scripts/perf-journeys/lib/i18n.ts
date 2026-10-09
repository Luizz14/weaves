import { readFileSync } from "node:fs";
import { join } from "node:path";

const CATALOG_ROOT = join(
	import.meta.dir,
	"../../../../../packages/i18n/locales",
);

function unquote(literal: string): string {
	return JSON.parse(literal) as string;
}

function catalogKey(id: string, context: string | null): string {
	return context === null ? id : `${context}\u0004${id}`;
}

export function parsePo(source: string): Map<string, string> {
	const entries = new Map<string, string>();
	let context: string | null = null;
	let id: string | null = null;
	let translation: string | null = null;
	let field: "msgctxt" | "msgid" | "msgstr" | null = null;

	const flush = () => {
		if (id !== null && id !== "" && translation !== null) {
			entries.set(catalogKey(id, context), translation || id);
		}
		context = null;
		id = null;
		translation = null;
		field = null;
	};

	for (const rawLine of source.split("\n")) {
		const line = rawLine.trim();
		if (line === "") {
			flush();
			continue;
		}
		if (line.startsWith("#")) continue;
		const match = line.match(/^(msgctxt|msgid|msgstr)\s+(".*")$/);
		if (match) {
			const [, keyword, literal] = match as [string, typeof field, string];
			if (keyword === "msgctxt" && (id !== null || translation !== null)) {
				flush();
			}
			field = keyword;
			const value = unquote(literal);
			if (keyword === "msgctxt") context = value;
			else if (keyword === "msgid") id = value;
			else translation = value;
			continue;
		}
		if (line.startsWith('"') && field) {
			const value = unquote(line);
			if (field === "msgctxt") context = (context ?? "") + value;
			else if (field === "msgid") id = (id ?? "") + value;
			else translation = (translation ?? "") + value;
		}
	}
	flush();
	return entries;
}

export interface Translator {
	locale: string;
	t(message: string, context?: string): string;
}

export function loadTranslator(lang: string | null | undefined): Translator {
	const locale = resolveLocale(lang);
	if (locale === "en") {
		return { locale, t: (message) => message };
	}
	const entries = parsePo(
		readFileSync(join(CATALOG_ROOT, locale, "messages.po"), "utf8"),
	);
	return {
		locale,
		t: (message, context) =>
			entries.get(catalogKey(message, context ?? null)) ?? message,
	};
}

function resolveLocale(lang: string | null | undefined): string {
	if (!lang) return "en";
	const normalized = lang.replace("_", "-");
	try {
		readFileSync(join(CATALOG_ROOT, normalized, "messages.po"));
		return normalized;
	} catch {
		const base = normalized.split("-")[0] ?? "en";
		try {
			readFileSync(join(CATALOG_ROOT, base, "messages.po"));
			return base;
		} catch {
			return "en";
		}
	}
}
