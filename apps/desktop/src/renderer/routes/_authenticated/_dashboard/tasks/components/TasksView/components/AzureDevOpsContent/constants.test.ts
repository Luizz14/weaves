import { describe, expect, test } from "bun:test";
import { canMoveAzureBoardItem } from "./constants";

describe("canMoveAzureBoardItem", () => {
	test("allows claim and adjacent manual stages", () => {
		expect(canMoveAzureBoardItem("backlog", "implementation")).toBe(true);
		expect(canMoveAzureBoardItem("implementation", "homologation")).toBe(true);
		expect(canMoveAzureBoardItem("homologation", "review")).toBe(true);
		expect(canMoveAzureBoardItem("review", "homologation")).toBe(true);
	});

	test("keeps backlog release and completion automatic", () => {
		expect(canMoveAzureBoardItem("implementation", "backlog")).toBe(false);
		expect(canMoveAzureBoardItem("review", "completed")).toBe(false);
		expect(canMoveAzureBoardItem("backlog", "review")).toBe(false);
	});
});
