import { describe, expect, it } from "bun:test";
import { adjacentOrganizationId } from "./adjacentOrganizationId";

describe("adjacentOrganizationId", () => {
	const order = ["a", "b", "c"];

	it("steps forward and backward", () => {
		expect(adjacentOrganizationId(order, "b", 1)).toBe("c");
		expect(adjacentOrganizationId(order, "b", -1)).toBe("a");
	});

	it("stops at the ends", () => {
		expect(adjacentOrganizationId(order, "c", 1)).toBeNull();
		expect(adjacentOrganizationId(order, "a", -1)).toBeNull();
	});

	it("ignores an unknown organization", () => {
		expect(adjacentOrganizationId(order, "z", 1)).toBeNull();
	});
});
