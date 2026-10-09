import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ALL_STARTUP_MARKERS,
	HOST_STARTUP_MARKERS,
	MAIN_STARTUP_MARKERS,
	RENDERER_STARTUP_MARKERS,
} from "../../../src/shared/startup-diagnostics";
import { P00_MARKERS } from "../lib/summary";

describe("startup marker lists", () => {
	test("every main, renderer and host marker is reported", () => {
		for (const marker of [
			...MAIN_STARTUP_MARKERS,
			...RENDERER_STARTUP_MARKERS,
			...HOST_STARTUP_MARKERS,
		]) {
			expect(ALL_STARTUP_MARKERS).toContain(marker);
		}
		expect(new Set(ALL_STARTUP_MARKERS).size).toBe(ALL_STARTUP_MARKERS.length);
		expect(P00_MARKERS).toEqual(ALL_STARTUP_MARKERS);
	});

	test("summarize-startup.py lists the same markers in the same order", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../summarize-startup.py"),
			"utf8",
		);
		const block = source.slice(
			source.indexOf("MARKERS = ("),
			source.indexOf(")", source.indexOf("MARKERS = (")),
		);
		const listed = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
		expect(listed).toEqual([...ALL_STARTUP_MARKERS]);
	});
});
