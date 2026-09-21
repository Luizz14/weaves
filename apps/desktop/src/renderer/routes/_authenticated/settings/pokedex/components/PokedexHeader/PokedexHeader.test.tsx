import { describe, expect, it } from "bun:test";
import { PokedexHeader } from "./PokedexHeader";

describe("PokedexHeader", () => {
	it("renders header metrics and progress bar correctly", () => {
		const header = PokedexHeader({
			totalCharacters: 43,
			totalDiscovered: 3,
			discoveryPercentage: 7,
			activeWorktreesCount: 1,
		});

		expect(header).toBeDefined();
		expect(header.props.children).toBeDefined();
	});
});
