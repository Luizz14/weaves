import { expect, test } from "bun:test";
import {
	loadLanguageSupport,
	peekLanguageSupport,
	subscribeLanguageSupport,
} from "./loadLanguageSupport";

test("a loaded language is available synchronously afterwards", async () => {
	expect(peekLanguageSupport("json")).toBeUndefined();
	let notified = 0;
	const unsubscribe = subscribeLanguageSupport(() => {
		notified++;
	});
	const [first, second] = await Promise.all([
		loadLanguageSupport("json"),
		loadLanguageSupport("json"),
	]);
	unsubscribe();
	expect(first).not.toBeNull();
	expect(second).toBe(first);
	expect(peekLanguageSupport("json")).toBe(first);
	expect(notified).toBe(1);
});

test("plain text resolves to no language, not to unloaded", async () => {
	expect(await loadLanguageSupport("plaintext")).toBeNull();
	expect(peekLanguageSupport("plaintext")).toBeNull();
});
