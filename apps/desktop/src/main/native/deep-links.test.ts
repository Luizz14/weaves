import { describe, expect, test } from "bun:test";
import type { NativeEvent } from "main/native/platform";
import { EarlyDeepLinkEventBuffer, extractDeepLinks } from "./deep-links";

describe("native deep-link event payloads", () => {
	test("accepts app single-string payloads", () => {
		expect(extractDeepLinks("superset://tasks/one")).toEqual([
			"superset://tasks/one",
		]);
	});

	test("accepts CEF popup url payloads", () => {
		expect(extractDeepLinks({ url: "superset://tasks/two" })).toEqual([
			"superset://tasks/two",
		]);
	});

	test("accepts OS-opened URL arrays while filtering malformed entries", () => {
		expect(
			extractDeepLinks({
				urls: ["superset://tasks/three", null, 1, "superset://tasks/four"],
			}),
		).toEqual(["superset://tasks/three", "superset://tasks/four"]);
	});

	test("rejects unrelated and malformed payloads", () => {
		expect(extractDeepLinks({ kind: "other" })).toEqual([]);
		expect(extractDeepLinks(null)).toEqual([]);
		expect(extractDeepLinks(["superset://tasks/five"])).toEqual([]);
	});

	test("buffers early events in order and flushes each exactly once", () => {
		const buffer = new EarlyDeepLinkEventBuffer(2);
		const first = {
			name: "app:deepLink",
			payload: { url: "superset://tasks/one" },
			windowLabel: "main",
		} satisfies NativeEvent;
		const second = {
			name: "deep-link",
			payload: { urls: ["superset://tasks/two"] },
			windowLabel: "secondary",
		} satisfies NativeEvent;
		const third = {
			name: "app:deepLink",
			payload: "superset://tasks/three",
			windowLabel: "main",
		} satisfies NativeEvent;
		const received: NativeEvent[] = [];
		const handler = (event: NativeEvent) => received.push(event);

		expect(buffer.receive(first)).toBe("buffered");
		expect(buffer.receive(second)).toBe("buffered");
		expect(buffer.receive(third)).toBe("dropped-oldest");
		buffer.activate(handler);
		buffer.activate(handler);
		const live = {
			name: "deep-link",
			payload: { url: "superset://tasks/four" },
			windowLabel: "secondary",
		} satisfies NativeEvent;
		expect(buffer.receive(live)).toBe("delivered");

		expect(received).toEqual([second, third, live]);
	});
});
