import { expect, test } from "bun:test";
import { memoizeByKey } from "./memoizeByKey";

test("returns the same value for the same key", () => {
	const memo = memoizeByKey<object>(4);
	const first = memo("a", () => ({}));
	expect(memo("a", () => ({}))).toBe(first);
});

test("evicts the least recently used key past the limit", () => {
	const memo = memoizeByKey<object>(2);
	const a = memo("a", () => ({}));
	memo("b", () => ({}));
	expect(memo("a", () => ({}))).toBe(a);
	memo("c", () => ({}));
	const b = memo("b", () => ({}));
	expect(memo("b", () => ({}))).toBe(b);
	expect(memo("a", () => ({}))).not.toBe(a);
});
