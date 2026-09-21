import { describe, expect, it } from "bun:test";
import { ProgressStat } from "./ProgressStat";

describe("ProgressStat", () => {
	it("renders correctly with label and value", () => {
		const stat = ProgressStat({ label: "Total", value: 43 });
		expect(stat).toBeDefined();
		expect(stat.props.children).toBeDefined();
	});

	it("applies highlight styles when highlight is true", () => {
		const stat = ProgressStat({
			label: "Ativos",
			value: "3",
			highlight: true,
		});
		expect(stat.props.className).toContain("text-emerald-400");
	});
});
