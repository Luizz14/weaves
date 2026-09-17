import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, cleanup } = await import("@testing-library/react");
const { ResizablePanel } = await import("./ResizablePanel");

afterEach(cleanup);

const handlers = {
	onWidthChange: () => undefined,
	onResizingChange: () => undefined,
	minWidth: 52,
	maxWidth: 400,
	handleSide: "right" as const,
};

test("the panel paints at its width on the first frame", () => {
	const view = render(
		<ResizablePanel isResizing={false} width={280} {...handlers}>
			<div data-testid="content" />
		</ResizablePanel>,
	);

	const panel = view.container.firstElementChild as HTMLElement;
	expect(panel.style.width).toBe("280px");
	expect(view.getByTestId("content").parentElement).toBe(panel);
});

test("a flexible panel takes no width and no handle", () => {
	const view = render(
		<ResizablePanel disabled isResizing={false} width={280} {...handlers}>
			<div data-testid="content" />
		</ResizablePanel>,
	);

	const panel = view.container.firstElementChild as HTMLElement;
	expect(panel.style.width).toBe("");
	expect(view.getByTestId("content").parentElement).toBe(panel);
	expect(view.queryByRole("separator")).toBeNull();
});
