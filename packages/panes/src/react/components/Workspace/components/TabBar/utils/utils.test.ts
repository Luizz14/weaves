import { describe, expect, it } from "bun:test";
import { computeInsertIndex, computeInsertLineLeft } from "./utils";

describe("tab insertion with variable widths", () => {
	const tabs = [
		{ left: 100, right: 220 },
		{ left: 220, right: 540 },
		{ left: 540, right: 720 },
	];

	it("uses each tab's midpoint instead of a fixed width", () => {
		expect(computeInsertIndex(90, tabs)).toBe(0);
		expect(computeInsertIndex(160, tabs)).toBe(0);
		expect(computeInsertIndex(161, tabs)).toBe(1);
		expect(computeInsertIndex(379, tabs)).toBe(1);
		expect(computeInsertIndex(381, tabs)).toBe(2);
		expect(computeInsertIndex(800, tabs)).toBe(3);
	});

	it("positions the indicator at the actual tab boundaries", () => {
		expect(computeInsertLineLeft(0, tabs, 100)).toBe(0);
		expect(computeInsertLineLeft(1, tabs, 100)).toBe(120);
		expect(computeInsertLineLeft(2, tabs, 100)).toBe(440);
		expect(computeInsertLineLeft(3, tabs, 100)).toBe(620);
	});

	it("keeps insertion and indicator positions correct when scrolled", () => {
		const scrolled = tabs.map(({ left, right }) => ({
			left: left - 300,
			right: right - 300,
		}));
		expect(computeInsertIndex(81, scrolled)).toBe(2);
		expect(computeInsertLineLeft(2, scrolled, -200)).toBe(440);
	});

	it("supports an empty tab track", () => {
		expect(computeInsertIndex(250, [])).toBe(0);
		expect(computeInsertLineLeft(0, [], 100)).toBe(0);
	});
});
