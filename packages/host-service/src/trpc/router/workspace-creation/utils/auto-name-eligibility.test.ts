import { describe, expect, test } from "bun:test";
import { isAutoNameEligible } from "./auto-name-eligibility";

const base = {
	name: "",
	nameSource: null,
	branch: "elizabeth-webber",
	type: "worktree",
} as const;

describe("isAutoNameEligible", () => {
	test("accepts a name defaulted at creation", () => {
		expect(
			isAutoNameEligible({
				...base,
				name: "feature/381316-aviso",
				branch: "feature/381316-aviso",
				nameSource: "auto",
			}),
		).toBe(true);
	});

	test("rejects typed and already generated names", () => {
		expect(isAutoNameEligible({ ...base, nameSource: "user" })).toBe(false);
		expect(isAutoNameEligible({ ...base, nameSource: "ai" })).toBe(false);
	});

	test("accepts a legacy row still named after its Ordem character", () => {
		expect(
			isAutoNameEligible({
				...base,
				name: "kiet/elizabeth-webber",
				branch: "kiet/elizabeth-webber",
			}),
		).toBe(true);
		expect(isAutoNameEligible(base)).toBe(true);
	});

	test("rejects a legacy row the user renamed by hand", () => {
		expect(isAutoNameEligible({ ...base, name: "aviso-saque" })).toBe(false);
	});

	test("rejects a legacy row whose branch is not a character", () => {
		expect(
			isAutoNameEligible({
				...base,
				name: "fix-login-loop",
				branch: "fix-login-loop",
			}),
		).toBe(false);
	});

	test("never renames session workspaces", () => {
		expect(
			isAutoNameEligible({ ...base, type: "session", nameSource: "auto" }),
		).toBe(false);
	});
});
