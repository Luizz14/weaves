import { describe, expect, test } from "bun:test";
import { createStartupRecorder } from "./recorder";

describe("startup durations", () => {
	test("records each milestone once, without wall-clock or user data", () => {
		const records: unknown[] = [];
		let elapsed = 42;
		const mark = createStartupRecorder({
			now: () => elapsed,
			write: (record) => records.push(record),
		});
		mark("process-start");
		mark("bootstrap-imports-end");
		elapsed = 90;
		mark("bootstrap-imports-end");
		mark("react-commit");
		expect(records).toEqual([
			{ marker: "process-start", durationMs: 0 },
			{ marker: "bootstrap-imports-end", durationMs: 42 },
			{ marker: "react-commit", durationMs: 90 },
		]);
	});
});
