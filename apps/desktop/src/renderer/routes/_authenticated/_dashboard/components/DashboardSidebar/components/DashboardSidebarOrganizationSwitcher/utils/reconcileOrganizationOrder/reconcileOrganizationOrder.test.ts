import { describe, expect, it } from "bun:test";
import { reconcileOrganizationOrder } from "./reconcileOrganizationOrder";

describe("reconcileOrganizationOrder", () => {
	it("keeps the stored order and appends new organizations", () => {
		expect(
			reconcileOrganizationOrder(
				["org-b", "org-a"],
				["org-a", "org-b", "org-c"],
			),
		).toEqual(["org-b", "org-a", "org-c"]);
	});

	it("prunes organizations that are no longer available", () => {
		expect(
			reconcileOrganizationOrder(
				["org-a", "org-removed", "org-b"],
				["org-a", "org-b"],
			),
		).toEqual(["org-a", "org-b"]);
	});

	it("removes duplicate stored ids", () => {
		expect(
			reconcileOrganizationOrder(
				["org-b", "org-b", "org-a"],
				["org-a", "org-b"],
			),
		).toEqual(["org-b", "org-a"]);
	});
});
