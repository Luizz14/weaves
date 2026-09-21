import { describe, expect, it } from "bun:test";
import { PokedexFilterBar } from "./PokedexFilterBar";

describe("PokedexFilterBar", () => {
	it("renders filter bar with search input and element options", () => {
		const component = PokedexFilterBar({
			searchQuery: "Arthur",
			onSearchChange: () => {},
			selectedCategory: "Todos",
			onSelectCategory: () => {},
			selectedElement: "Sangue",
			onSelectElement: () => {},
			onlyDiscovered: false,
			onToggleOnlyDiscovered: () => {},
		});

		expect(component).toBeDefined();
		expect(component.props.children).toBeDefined();
	});
});
