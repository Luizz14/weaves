import { expect, test } from "bun:test";
import { darkTheme, lightTheme } from "shared/themes";
import { getCodeSyntaxHighlighting } from "../syntax-highlighting";
import { createCodeMirrorTheme } from "./createCodeMirrorTheme";

test("equal themes and fonts reuse the same editor styles", () => {
	const copy = structuredClone(darkTheme);
	expect(createCodeMirrorTheme(copy, { fontSize: 13 }, true)).toBe(
		createCodeMirrorTheme(darkTheme, { fontSize: 13 }, true),
	);
	expect(getCodeSyntaxHighlighting(copy)).toBe(
		getCodeSyntaxHighlighting(darkTheme),
	);
});

test("a different theme or font builds new editor styles", () => {
	const base = createCodeMirrorTheme(darkTheme, { fontSize: 13 }, true);
	expect(createCodeMirrorTheme(darkTheme, { fontSize: 14 }, true)).not.toBe(
		base,
	);
	expect(createCodeMirrorTheme(lightTheme, { fontSize: 13 }, true)).not.toBe(
		base,
	);
	expect(getCodeSyntaxHighlighting(lightTheme)).not.toBe(
		getCodeSyntaxHighlighting(darkTheme),
	);
});
