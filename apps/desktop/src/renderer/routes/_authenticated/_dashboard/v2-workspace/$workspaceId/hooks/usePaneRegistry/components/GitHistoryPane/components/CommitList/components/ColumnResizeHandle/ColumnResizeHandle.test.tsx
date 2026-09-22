import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ColumnResizeHandle } from "./ColumnResizeHandle";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, fireEvent, cleanup } = await import("@testing-library/react");
afterEach(cleanup);

test("column resizing uses its displayed width, clamps and supports keyboard", () => {
	const resize = mock(() => {});
	const view = render(
		<div>
			<ColumnResizeHandle
				label="Commits"
				width={240}
				minWidth={240}
				onResize={resize}
			/>
		</div>,
	);
	const handle = view.getByRole("separator", { name: "Commits" });
	if (!handle.parentElement) throw new Error("Missing column");
	handle.parentElement.getBoundingClientRect = () =>
		({ width: 600 }) as DOMRect;
	handle.setPointerCapture = () => {};
	handle.hasPointerCapture = () => false;
	fireEvent.pointerDown(handle, { button: 0, clientX: 600, pointerId: 1 });
	fireEvent.pointerMove(handle, { clientX: 800, pointerId: 1 });
	expect(resize).toHaveBeenLastCalledWith(800);
	fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
	expect(resize).toHaveBeenLastCalledWith(240);
	fireEvent.pointerCancel(handle);
	resize.mockClear();
	fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 });
	expect(resize).not.toHaveBeenCalled();
	fireEvent.keyDown(handle, { key: "ArrowRight" });
	expect(resize).toHaveBeenLastCalledWith(624);
});
