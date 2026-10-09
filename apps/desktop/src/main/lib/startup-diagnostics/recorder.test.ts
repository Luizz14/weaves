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

describe("explicit durations", () => {
	test("uses the given duration, rejects invalid ones and stays at-most-once", () => {
		const records: unknown[] = [];
		const mark = createStartupRecorder({
			now: () => 5,
			write: (record) => records.push(record),
		});
		mark("host-listening", -1);
		mark("host-db-ready", Number.NaN);
		mark("host-listening", 812.5);
		mark("host-listening");
		mark("app-ready");
		expect(records).toEqual([
			{ marker: "host-listening", durationMs: 812.5 },
			{ marker: "app-ready", durationMs: 5 },
		]);
	});
});
