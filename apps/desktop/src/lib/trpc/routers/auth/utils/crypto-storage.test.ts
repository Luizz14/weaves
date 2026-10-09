import { describe, expect, test } from "bun:test";

// auth-functions.test.ts replaces "./crypto-storage" for the whole run; the
// query string loads the real module regardless of file order.
const unmockedSpecifier = "./crypto-storage.ts?unmocked";
const { decrypt, encrypt, primeKeyFor } = (await import(
	unmockedSpecifier
)) as typeof import("./crypto-storage");

const SALT_LENGTH = 16;
const IV_END = SALT_LENGTH + 12;

describe("crypto-storage", () => {
	test("round-trips and never repeats an IV", () => {
		const first = encrypt("token-a");
		const second = encrypt("token-a");

		expect(decrypt(first)).toBe("token-a");
		expect(decrypt(second)).toBe("token-a");
		expect(first.subarray(SALT_LENGTH, IV_END)).not.toEqual(
			second.subarray(SALT_LENGTH, IV_END),
		);
	});

	test("rewrites with the salt it last read, so the key is derived once", async () => {
		const stored = encrypt("stored");
		await primeKeyFor(stored);
		expect(decrypt(stored)).toBe("stored");

		const rewritten = encrypt("rewritten");
		expect(rewritten.subarray(0, SALT_LENGTH)).toEqual(
			stored.subarray(0, SALT_LENGTH),
		);
		expect(decrypt(rewritten)).toBe("rewritten");
	});

	test("ignores data too short to carry a salt", async () => {
		await primeKeyFor(Buffer.alloc(4));
		expect(() => decrypt(Buffer.alloc(4))).toThrow("Encrypted data too short");
	});
});
