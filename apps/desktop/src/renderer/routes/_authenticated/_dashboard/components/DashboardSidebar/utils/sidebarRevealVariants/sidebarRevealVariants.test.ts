import { describe, expect, test } from "bun:test";
import { getSidebarRevealListVariants } from "./sidebarRevealVariants";

describe("sidebar reveal timing", () => {
	test.each([
		0, 1, 5, 100, 500, 1000,
	])("bounds cascade delay for %i rows", (count) => {
		const variants = getSidebarRevealListVariants(count, false);
		const intervals = Math.max(0, count - 1);
		expect(
			variants.open.transition.staggerChildren * intervals,
		).toBeLessThanOrEqual(0.180001);
		expect(
			variants.closed.transition.staggerChildren * intervals,
		).toBeLessThanOrEqual(0.100001);
	});
	test("retains small-list timing", () => {
		const variants = getSidebarRevealListVariants(4, false);
		expect(variants.open.transition.staggerChildren).toBe(0.03);
		expect(variants.closed.transition.staggerChildren).toBe(0.018);
	});
	test("reduced motion has no cascade or container duration", () => {
		const variants = getSidebarRevealListVariants(1000, true);
		for (const variant of [variants.open, variants.closed]) {
			expect(variant.transition.staggerChildren).toBe(0);
			expect(variant.transition.height.duration).toBe(0);
			expect(variant.transition.opacity.duration).toBe(0);
		}
	});
});
