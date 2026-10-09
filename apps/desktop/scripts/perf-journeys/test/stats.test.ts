import { describe, expect, test } from "bun:test";
import { nearestRank, summarizeDistribution } from "../lib/stats";

describe("nearestRank", () => {
	test("matches summarize-startup.py for p50/p95", () => {
		const values = [5, 1, 4, 2, 3, 6, 8, 7, 9, 10];
		expect(nearestRank(values, 0.5)).toBe(5);
		expect(nearestRank(values, 0.75)).toBe(8);
		expect(nearestRank(values, 0.95)).toBe(10);
	});

	test("returns null for an empty set", () => {
		expect(nearestRank([], 0.75)).toBeNull();
	});
});

describe("summarizeDistribution", () => {
	test("flags p95 as the maximum below 20 samples and drops non-finite values", () => {
		const summary = summarizeDistribution([3, Number.NaN, 1, 2]);
		expect(summary.n).toBe(3);
		expect(summary.p95).toBe(3);
		expect(summary.p95IsMax).toBe(true);
	});
});
