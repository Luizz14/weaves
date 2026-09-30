import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { TaskSource } from "../TasksTopBar/TasksTopBar";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
	"@testing-library/react"
);
let configured = true;
let loading = false;
let focusSearch: (() => void) | null = null;
const navigate = mock(() => {});
const onSourceChange = mock((_source: TaskSource) => {});
const boardInputs: Array<{ includeClaimed: boolean }> = [];
mock.module("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));
mock.module("renderer/hotkeys", () => ({
	useHotkey: (_key: string, handler: () => void) => {
		focusSearch = handler;
	},
}));
mock.module("renderer/hooks/host-service/useHostTargetUrl", () => ({
	useHostUrls: () => [],
}));
mock.module("renderer/hooks/useAzureDevOpsBoardAvailability", () => ({
	useAzureDevOpsBoardAvailability: () => ({
		configuredTarget: configured
			? { url: "http://azure-host", hostId: "local" }
			: null,
		isLoading: loading,
	}),
}));
mock.module(
	"renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions",
	() => ({
		useWorkspaceHostOptions: () => ({
			currentDeviceName: "Mac",
			localHostId: "local",
			otherHosts: [],
		}),
	}),
);
mock.module(
	"renderer/routes/_authenticated/providers/HostWorkspacesProvider",
	() => ({ useHostWorkspaces: () => ({ workspaces: [] }) }),
);
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: () => ({
		azureDevOps: {
			listBoard: {
				query: async (input: { includeClaimed: boolean }) => {
					boardInputs.push(input);
					return {
						iterationPath: "Sprint",
						iterations: [{ id: "sprint", path: "Sprint", name: "Sprint" }],
						items: [
							{
								id: 381316,
								title: "Aviso Saque",
								tags: ["Android"],
								stage: "homologation",
							},
							{
								id: 381319,
								title: "Outro item",
								tags: ["iOS"],
								stage: "review",
							},
						],
					};
				},
			},
		},
	}),
}));
mock.module("./components/AzureDevOpsBoard", () => ({
	AzureDevOpsBoard: ({
		items,
	}: {
		items: Array<{ id: number; title: string }>;
	}) => (
		<ul>
			{items.map((item) => (
				<li key={item.id}>{item.title}</li>
			))}
		</ul>
	),
}));
const { AzureDevOpsContent } = await import("./AzureDevOpsContent");
let client: QueryClient;
beforeEach(() => {
	configured = true;
	loading = false;
	boardInputs.length = 0;
	onSourceChange.mockClear();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
	cleanup();
	client.clear();
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});
function AzureTasks() {
	const [search, setSearch] = useState("");
	return (
		<AzureDevOpsContent
			searchQuery={search}
			onSearchChange={setSearch}
			availableTaskSources={["tasks", "azure"]}
			onTaskSourceChange={onSourceChange}
		/>
	);
}
function mount() {
	return render(
		<QueryClientProvider client={client}>
			<AzureTasks />
		</QueryClientProvider>,
	);
}
describe("Azure task toolbar", () => {
	test("keeps search, sources and Azure controls in one toolbar without editing", async () => {
		const { container } = mount();
		const page = within(document.body);
		await waitFor(() => expect(page.queryByText("Aviso Saque")).not.toBeNull());
		expect(container.querySelectorAll("[data-tasks-toolbar]")).toHaveLength(1);
		const toolbar = container.querySelector("[data-tasks-toolbar]");
		expect(toolbar).not.toBeNull();
		const controls = within(toolbar as HTMLElement);
		expect(
			controls.getByRole("textbox", { name: "Search Azure work items" }),
		).not.toBeNull();
		expect(controls.getByRole("button", { name: "Mine" })).not.toBeNull();
		expect(
			controls.getByRole("button", { name: "Refresh Azure DevOps board" }),
		).not.toBeNull();
		expect(
			controls.queryByRole("button", {
				name: "Edit Azure DevOps board configuration",
			}),
		).toBeNull();
		await act(async () => {
			fireEvent.mouseDown(controls.getByRole("tab", { name: "Linear" }), {
				button: 0,
				ctrlKey: false,
			});
		});
		expect(onSourceChange).toHaveBeenCalledWith("tasks");
	});
	test("preserves search by text, tag and number, focus shortcut and Escape", async () => {
		mount();
		const page = within(document.body);
		await waitFor(() => expect(page.queryByText("Aviso Saque")).not.toBeNull());
		const search = page.getByRole("textbox", {
			name: "Search Azure work items",
		});
		await act(async () => {
			focusSearch?.();
		});
		expect(document.activeElement).toBe(search);
		for (const query of ["aviso", "Android", "381316"]) {
			await act(async () => {
				fireEvent.change(search, { target: { value: query } });
			});
			expect(page.queryByText("Aviso Saque")).not.toBeNull();
			expect(page.queryByText("Outro item")).toBeNull();
		}
		await act(async () => {
			fireEvent.keyDown(search, { key: "Escape" });
		});
		expect((search as HTMLInputElement).value).toBe("");
		expect(page.queryByText("Outro item")).not.toBeNull();
		expect(document.activeElement).not.toBe(search);
	});
	test("keeps Mine/All and refresh working after moving search", async () => {
		mount();
		const page = within(document.body);
		await waitFor(() => expect(boardInputs).toHaveLength(1));
		await act(async () => {
			fireEvent.click(page.getByRole("button", { name: "Mine" }));
		});
		await waitFor(() => expect(boardInputs.at(-1)?.includeClaimed).toBe(true));
		await act(async () => {
			fireEvent.click(
				page.getByRole("button", { name: "Refresh Azure DevOps board" }),
			);
		});
		await waitFor(() => expect(boardInputs).toHaveLength(3));
	});
	test("directs unconfigured organizations to Integrations settings", () => {
		configured = false;
		mount();
		const page = within(document.body);
		expect(
			page
				.getByRole("link", { name: "Open Integrations settings" })
				.getAttribute("href"),
		).toBe("/settings/integrations");
		expect(
			page.queryByRole("button", { name: "Connect Azure DevOps" }),
		).toBeNull();
		expect(page.queryByRole("dialog")).toBeNull();
	});
	test("keeps source navigation available while looking for an integration", () => {
		configured = false;
		loading = true;
		mount();
		const page = within(document.body);
		expect(page.getByText("Looking for an Azure DevOps board…")).not.toBeNull();
		expect(page.getByRole("tab", { name: "Linear" })).not.toBeNull();
	});
});
