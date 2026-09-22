import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { cleanup, render } = await import("@testing-library/react");
const React = await import("react");
const { CardFoilEffect } = await import("./CardFoilEffect");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

describe("CardFoilEffect", () => {
	test("renders wrapper and children", () => {
		const { getByTestId } = render(
			React.createElement(
				CardFoilEffect,
				null,
				React.createElement("div", { "data-testid": "inner" }, "Card Content"),
			),
		);

		expect(getByTestId("inner")).toBeDefined();
		expect(getByTestId("inner").textContent).toBe("Card Content");
	});
});
