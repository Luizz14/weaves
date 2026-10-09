import { describe, expect, test } from "bun:test";
import { launchSchedule } from "../lib/schedule";

describe("launchSchedule", () => {
	test("keeps the first launch inspected and interleaves plain launches", () => {
		const schedule = launchSchedule(21, 10);
		expect(schedule).toHaveLength(31);
		expect(schedule[0]).toBe(true);
		expect(schedule.filter((inspect) => !inspect)).toHaveLength(10);
		expect(schedule.filter(Boolean)).toHaveLength(21);
	});

	test("handles no plain launches", () => {
		expect(launchSchedule(3, 0)).toEqual([true, true, true]);
	});
});
