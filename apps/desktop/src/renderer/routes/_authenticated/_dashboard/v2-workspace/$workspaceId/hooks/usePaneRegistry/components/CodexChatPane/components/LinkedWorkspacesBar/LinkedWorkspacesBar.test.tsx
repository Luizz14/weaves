import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, cleanup, fireEvent } = await import("@testing-library/react");
const { LinkedWorkspacesBar } = await import("./LinkedWorkspacesBar");

afterEach(cleanup);

test("nothing renders without linked workspaces", () => {
	const view = render(
		<LinkedWorkspacesBar onRemove={() => undefined} workspaces={[]} />,
	);

	expect(view.container.innerHTML).toBe("");
});

test("a chip shows the workspace name and its branch", () => {
	const view = render(
		<LinkedWorkspacesBar
			onRemove={() => undefined}
			workspaces={[
				{ id: "ws-1", name: "previsao-anual", branch: "feature/previsao" },
			]}
		/>,
	);

	expect(view.getByText("previsao-anual")).toBeDefined();
	expect(view.getByText("feature/previsao")).toBeDefined();
});

test("removing a chip reports that workspace", () => {
	const onRemove = mock(() => undefined);
	const view = render(
		<LinkedWorkspacesBar
			onRemove={onRemove}
			workspaces={[
				{ id: "ws-1", name: "first", branch: null },
				{ id: "ws-2", name: "second", branch: "main" },
			]}
		/>,
	);

	fireEvent.click(view.getByLabelText("Unlink second"));

	expect(onRemove).toHaveBeenCalledWith("ws-2");
});
