import { describe, expect, it } from "bun:test";
import { ElementBadge } from "./ElementBadge";

describe("ElementBadge", () => {
	it("renders element badge component correctly", () => {
		const badge = ElementBadge({ element: "Sangue" });
		expect(badge).toBeDefined();
		expect(badge.props.className).toContain("text-red-500");
	});

	it("falls back gracefully for neutral / unknown element", () => {
		const badge = ElementBadge({ element: "Nenhum" });
		expect(badge).toBeDefined();
		expect(badge.props.className).toContain("text-zinc-400");
	});
});
