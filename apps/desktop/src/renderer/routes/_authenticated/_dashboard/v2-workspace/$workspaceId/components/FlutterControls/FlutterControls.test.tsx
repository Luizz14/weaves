import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createWorkspaceStore } from "@superset/panes";
import type { FlutterSessionSnapshot } from "@superset/shared/flutter";
import type { DocumentSaveEvent } from "../../state/fileDocumentStore/fileDocumentStore";
import type { SharedFileDocument } from "../../state/fileDocumentStore/types";
import type { PaneViewerData } from "../../types";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, screen, waitFor } = await import(
	"@testing-library/react"
);
const previousResizeObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as typeof ResizeObserver;

let session: FlutterSessionSnapshot | null = null;
let profilesAvailable = true;
const observers = new Set<(event: DocumentSaveEvent) => void>();
const control = mock(
	async (_input: {
		workspaceId: string;
		sessionId: string;
		action: string;
		reason?: string;
	}) => {},
);
const client = {
	flutter: {
		status: { query: async () => session },
		control: { mutate: control },
	},
};
mock.module("@superset/workspace-client", () => ({
	useWorkspaceClient: () => ({ trpcClient: client }),
	workspaceTrpc: {
		flutter: {
			profiles: {
				useQuery: () => ({
					data: profilesAvailable
						? [
								{
									id: "profile",
									name: "Flutter app",
									diagnostics: [],
									hash: "hash",
								},
							]
						: [],
				}),
			},
			devices: {
				useQuery: () => ({
					data: [{ id: "device", name: "Test device" }],
					refetch: async () => {},
				}),
			},
			status: { useQuery: () => ({ data: session, refetch: async () => {} }) },
		},
	},
}));
mock.module(
	"renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider",
	() => ({
		useWorkspace: () => ({ workspace: { id: "workspace", hostId: "local" } }),
	}),
);
mock.module(
	"renderer/routes/_authenticated/providers/LocalHostServiceProvider",
	() => ({ useLocalHostService: () => ({ machineId: "local" }) }),
);
mock.module("../../state/lsp/LspProvider", () => ({
	useLspCoordinator: () => null,
}));
mock.module("../../state/fileDocumentStore/fileDocumentStore", () => ({
	getWorkspaceDocuments: () => [],
	observeDocumentSaves: (listener: (event: DocumentSaveEvent) => void) => {
		observers.add(listener);
		return () => {
			observers.delete(listener);
		};
	},
}));
const { FlutterControls } = await import("./FlutterControls");
const { WorkspaceActionDock } = await import(
	"../WorkspaceSidebar/components/WorkspaceActionDock"
);
beforeEach(() => {
	session = null;
	profilesAvailable = true;
	control.mockClear();
	observers.clear();
});
afterEach(cleanup);
afterAll(async () => {
	globalThis.ResizeObserver = previousResizeObserver;
	if (!registered) await GlobalRegistrator.unregister();
});

function fixture() {
	const store = createWorkspaceStore<PaneViewerData>();
	return (
		<FlutterControls store={store}>
			<WorkspaceActionDock
				isCollapsed={false}
				gitContent={<span>Git actions</span>}
				openInContent={null}
				commandsContent={null}
			/>
		</FlutterControls>
	);
}

test("Flutter dock keeps device selection and manual-save reload while the menu is closed", async () => {
	const element = fixture();
	const view = render(element);
	const tab = screen.getByRole("tab", { name: "Flutter" });
	expect(screen.queryByRole("button", { name: "Refresh devices" })).toBeNull();
	fireEvent.click(tab);
	fireEvent.change(screen.getByRole("combobox", { name: "Flutter device" }), {
		target: { value: "device" },
	});
	fireEvent.click(tab);
	fireEvent.click(tab);
	expect(
		(
			screen.getByRole("combobox", {
				name: "Flutter device",
			}) as HTMLSelectElement
		).value,
	).toBe("device");
	fireEvent.click(tab);
	session = {
		id: "session",
		workspaceId: "workspace",
		profileName: "Flutter app",
		deviceId: "device",
		phase: "running",
		mode: "debug",
		canReload: true,
		canInspect: true,
		selectingWidget: false,
		output: "",
	};
	view.rerender(
		<FlutterControls store={createWorkspaceStore<PaneViewerData>()}>
			{element.props.children}
		</FlutterControls>,
	);
	expect(screen.queryByRole("button", { name: "Hot reload" })).toBeNull();
	expect(observers.size).toBe(1);
	const document = {
		workspaceId: "workspace",
		absolutePath: "/tmp/app/lib/main.dart",
	} as SharedFileDocument;
	await act(async () => {
		for (const listener of observers)
			listener({
				requestId: "save",
				phase: "start",
				origin: "manual",
				document,
			});
		for (const listener of observers)
			listener({
				requestId: "save",
				phase: "complete",
				origin: "manual",
				document,
				result: { status: "saved", revision: "fixture-revision" },
			});
	});
	await waitFor(() =>
		expect(control).toHaveBeenCalledWith({
			workspaceId: "workspace",
			sessionId: "session",
			action: "reload",
			reason: "save",
		}),
	);
	expect(control).toHaveBeenCalledTimes(1);
});

test("an unavailable Flutter tab returns to Git without losing the other action tabs", async () => {
	const element = fixture();
	const view = render(element);
	fireEvent.click(screen.getByRole("tab", { name: "Flutter" }));
	profilesAvailable = false;
	view.rerender(
		<FlutterControls store={createWorkspaceStore<PaneViewerData>()}>
			{element.props.children}
		</FlutterControls>,
	);
	await waitFor(() =>
		expect(screen.queryByRole("tab", { name: "Flutter" })).toBeNull(),
	);
	expect(
		screen.getByRole("tab", { name: "Git" }).getAttribute("aria-selected"),
	).toBe("true");
	expect(screen.getByRole("tab", { name: "Commands" })).toBeTruthy();
});
