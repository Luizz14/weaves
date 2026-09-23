import { describe, expect, it } from "bun:test";
import { stepSelection } from "./stepSelection";

describe("stepSelection", () => {
	it("opens on the previous workspace", () => {
		expect(stepSelection(null, 4, false)).toBe(1);
	});

	it("opens on the oldest workspace when going backward", () => {
		expect(stepSelection(null, 4, true)).toBe(3);
	});

	it("wraps in both directions", () => {
		expect(stepSelection(3, 4, false)).toBe(0);
		expect(stepSelection(0, 4, true)).toBe(3);
	});

	it("handles tiny lists", () => {
		expect(stepSelection(null, 0, false)).toBeNull();
		expect(stepSelection(null, 1, false)).toBe(0);
	});
});
