import { describe, expect, test } from "bun:test";
import {
	formatStartupMarkerLine,
	parseStartupMarkerLines,
} from "./startup-markers";

describe("parseStartupMarkerLines", () => {
	test("reads marker lines split across chunks and keeps the remainder", () => {
		const line = formatStartupMarkerLine("host-listening", 123456789n);
		const first = parseStartupMarkerLines("", `log line\n${line.slice(0, 12)}`);
		expect(first.markers).toEqual([]);
		const second = parseStartupMarkerLines(
			first.carry,
			`${line.slice(12)}tail`,
		);
		expect(second.markers).toEqual([
			{ marker: "host-listening", hrtimeNs: 123456789n },
		]);
		expect(second.carry).toBe("tail");
	});

	test("drops unknown markers and malformed values", () => {
		const { markers } = parseStartupMarkerLines(
			"",
			"@@superset-startup host-unknown 1\n@@superset-startup host-listening abc\n@@superset-startup host-db-ready 7\n",
		);
		expect(markers).toEqual([{ marker: "host-db-ready", hrtimeNs: 7n }]);
	});

	test("bounds the carry for long lines without a newline", () => {
		const { carry } = parseStartupMarkerLines("", "x".repeat(10_000));
		expect(carry.length).toBe(4096);
	});
});
