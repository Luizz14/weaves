import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SidebarVirtualList } from "./SidebarVirtualList";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const { act, cleanup, render } = await import("@testing-library/react");
const heightDescriptor = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"offsetHeight",
);
const widthDescriptor = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"offsetWidth",
);
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
	configurable: true,
	get() {
		return this.hasAttribute("data-sidebar-scroll-container") ? 280 : 28;
	},
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
	configurable: true,
	get() {
		return 300;
	},
});
afterEach(cleanup);
afterAll(async () => {
	if (heightDescriptor)
		Object.defineProperty(
			HTMLElement.prototype,
			"offsetHeight",
			heightDescriptor,
		);
	else Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
	if (widthDescriptor)
		Object.defineProperty(
			HTMLElement.prototype,
			"offsetWidth",
			widthDescriptor,
		);
	else Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
	if (!registered) await GlobalRegistrator.unregister();
});
const items = Array.from({ length: 1000 }, (_, index) => `workspace-${index}`);
const row = (id: string) => <button type="button">{id}</button>;

test("large lists mount a window, retain requested rows and mount every row for dragging", () => {
	const view = (dragging: boolean) => (
		<div data-sidebar-scroll-container>
			<SidebarVirtualList
				items={items}
				isDragging={dragging}
				retainedItemIds={["workspace-900"]}
			>
				{row}
			</SidebarVirtualList>
		</div>
	);
	const result = render(view(false));
	expect(
		result.container.querySelectorAll("[data-sidebar-row-id]").length,
	).toBeLessThan(40);
	expect(result.getByText("workspace-900")).toBeTruthy();
	const original = result.getByText("workspace-0");
	act(() => result.rerender(view(true)));
	expect(
		result.container.querySelectorAll("[data-sidebar-row-id]"),
	).toHaveLength(1000);
	expect(result.getByText("workspace-0")).toBe(original);
	act(() => result.rerender(view(false)));
	expect(
		result.container.querySelectorAll("[data-sidebar-row-id]").length,
	).toBeLessThan(40);
	expect(result.getByText("workspace-0")).toBe(original);
});

test("collapsed members remain in the full drag model but not the scroll window", () => {
	const visible = items.slice(0, 10);
	const view = (dragging: boolean) => (
		<div data-sidebar-scroll-container>
			<SidebarVirtualList
				items={visible}
				fullItems={items}
				isDragging={dragging}
			>
				{row}
			</SidebarVirtualList>
		</div>
	);
	const result = render(view(false));
	expect(
		result.container.querySelectorAll("[data-sidebar-row-id]"),
	).toHaveLength(10);
	act(() => result.rerender(view(true)));
	expect(
		result.container.querySelectorAll("[data-sidebar-row-id]"),
	).toHaveLength(1000);
});

test("small lists keep the complete natural flow", () => {
	const result = render(
		<div data-sidebar-scroll-container>
			<SidebarVirtualList items={items.slice(0, 20)} isDragging={false}>
				{row}
			</SidebarVirtualList>
		</div>,
	);
	expect(
		result.container.querySelectorAll("[data-sidebar-row-id]"),
	).toHaveLength(20);
	expect(result.container.querySelector("[data-index]")).toBeNull();
});
