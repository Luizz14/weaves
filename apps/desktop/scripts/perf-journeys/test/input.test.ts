import { describe, expect, test } from "bun:test";
import type { Cdp } from "../lib/cdp";
import {
	EnterRefusedError,
	insertText,
	parseChord,
	pressChord,
	typeCharacter,
} from "../lib/input";

function fakeCdp(allowEnter: boolean) {
	const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
	const cdp = {
		send: async (method: string, params: Record<string, unknown> = {}) => {
			sent.push({ method, params });
			return {};
		},
		eval: async () => allowEnter,
	} as unknown as Cdp;
	return { cdp, sent };
}

describe("parseChord", () => {
	test("maps a meta chord to a physical code without text", () => {
		expect(parseChord("meta+j")).toMatchObject({
			code: "KeyJ",
			keyCode: 74,
			modifiers: ["meta"],
			text: undefined,
		});
	});

	test("drops the carriage return from modified Enter", () => {
		expect(parseChord("meta+enter").text).toBeUndefined();
		expect(parseChord("enter").text).toBe("\r");
	});
});

describe("Enter guard", () => {
	test("refuses Enter without an allowed context", async () => {
		const { cdp, sent } = fakeCdp(true);
		await expect(pressChord(cdp, "enter")).rejects.toBeInstanceOf(
			EnterRefusedError,
		);
		expect(sent).toHaveLength(0);
	});

	test("refuses Enter when focus is outside the allowed context", async () => {
		const { cdp, sent } = fakeCdp(false);
		await expect(
			pressChord(cdp, "enter", { allowEnterIn: "cmdk-input" }),
		).rejects.toBeInstanceOf(EnterRefusedError);
		expect(sent).toHaveLength(0);
	});

	test("sends Enter inside an allowed context", async () => {
		const { cdp, sent } = fakeCdp(true);
		await pressChord(cdp, "enter", { allowEnterIn: "cmdk-input" });
		expect(sent.map((s) => s.params.type)).toEqual(["keyDown", "keyUp"]);
	});

	test("refuses newlines in inserted text and non-alphanumeric typing", async () => {
		const { cdp } = fakeCdp(true);
		await expect(insertText(cdp, "ls\n")).rejects.toBeInstanceOf(
			EnterRefusedError,
		);
		await expect(typeCharacter(cdp, "\r")).rejects.toThrow();
	});
});

describe("typeInShell", () => {
	test("refuses to type when focus is not in the expected shell", async () => {
		const { typeInShell } = await import("../lib/input");
		const { cdp, sent } = fakeCdp(false);
		await expect(
			typeInShell(cdp, "claude", '[data-workspace-id="w"]'),
		).rejects.toBeInstanceOf(EnterRefusedError);
		expect(sent).toHaveLength(0);
	});

	test("refuses Enter in a shell outside the expected workspace", async () => {
		const { cdp, sent } = fakeCdp(false);
		await expect(
			pressChord(cdp, "enter", {
				allowEnterIn: { shellIn: '[data-workspace-id="w"]' },
			}),
		).rejects.toBeInstanceOf(EnterRefusedError);
		expect(sent).toHaveLength(0);
	});
});
