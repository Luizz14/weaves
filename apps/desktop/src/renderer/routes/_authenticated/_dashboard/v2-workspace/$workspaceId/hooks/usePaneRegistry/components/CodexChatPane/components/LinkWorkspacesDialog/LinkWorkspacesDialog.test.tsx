import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, cleanup, fireEvent, act } = await import(
	"@testing-library/react"
);
const { LinkWorkspacesDialog } = await import("./LinkWorkspacesDialog");
type LinkableWorkspace = import("./LinkWorkspacesDialog").LinkableWorkspace;

afterEach(cleanup);

const workspaces: LinkableWorkspace[] = [
	{
		id: "ws-1",
		name: "previsao-anual",
		branch: "feature/previsao",
		projectId: "p-1",
		projectName: "Painel",
	},
	{
		id: "ws-2",
		name: "carregar-mais",
		branch: "feature/carregar-mais",
		projectId: "p-2",
		projectName: "Mobile",
	},
];

function renderDialog(
	overrides: Partial<Parameters<typeof LinkWorkspacesDialog>[0]> = {},
) {
	const onOpenChange = mock(() => undefined);
	const onToggle = mock(() => undefined);
	const view = render(
		<LinkWorkspacesDialog
			linkedIds={[]}
			onOpenChange={onOpenChange}
			onToggle={onToggle}
			open
			workspaces={workspaces}
			{...overrides}
		/>,
	);
	return { view, onOpenChange, onToggle };
}

test("rows are grouped under their project name", () => {
	const { view } = renderDialog();

	expect(view.getByText("Painel")).toBeDefined();
	expect(view.getByText("Mobile")).toBeDefined();
	expect(view.getByText("previsao-anual")).toBeDefined();
	expect(view.getByText("feature/previsao")).toBeDefined();
});

test("selecting a row reports the toggle and keeps the dialog open", async () => {
	const { view, onToggle, onOpenChange } = renderDialog();

	await act(async () => {
		fireEvent.click(view.getByText("carregar-mais"));
	});

	expect(onToggle).toHaveBeenCalledWith("ws-2");
	expect(onOpenChange).not.toHaveBeenCalled();
	expect(view.getByText("previsao-anual")).toBeDefined();
});

test("searching narrows the list to matching workspaces", async () => {
	const { view } = renderDialog();

	await act(async () => {
		fireEvent.change(view.getByPlaceholderText("Search workspaces…"), {
			target: { value: "carregar" },
		});
	});

	expect(view.queryByText("previsao-anual")).toBeNull();
	expect(view.getByText("carregar-mais")).toBeDefined();
});

test("a search matching nothing shows the empty state", async () => {
	const { view } = renderDialog();

	await act(async () => {
		fireEvent.change(view.getByPlaceholderText("Search workspaces…"), {
			target: { value: "zzzz" },
		});
	});

	expect(view.getByText("No workspaces found.")).toBeDefined();
});

test("linked rows are announced as linked", () => {
	const { view } = renderDialog({ linkedIds: ["ws-1"] });

	const rows = view.getAllByText("Linked");
	expect(rows).toHaveLength(1);
});

test("the loading state replaces the list", () => {
	const { view } = renderDialog({ isLoading: true });

	expect(view.getByText("Loading workspaces…")).toBeDefined();
	expect(view.queryByText("previsao-anual")).toBeNull();
});
