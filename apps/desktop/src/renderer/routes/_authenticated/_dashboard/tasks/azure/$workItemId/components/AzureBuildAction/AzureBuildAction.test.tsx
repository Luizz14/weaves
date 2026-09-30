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
import type {
	AzureBuildConfig,
	AzureBuildOptions,
	AzureBuildWorkspace,
} from "./hooks/useAzureBuild";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
	"@testing-library/react"
);
const configs = new Map<string, AzureBuildConfig | null>();
const calls: Array<{
	hostUrl: string;
	input: AzureBuildOptions & { workspaceId: string; workItemId: number };
}> = [];
let failBuild = false;
let finishBuild: (() => void) | null = null;
let holdBuild = false;
const successToast = mock(() => {});
const errorToast = mock(() => {});
mock.module("@superset/ui/sonner", () => ({
	toast: { success: successToast, error: errorToast },
}));
mock.module("renderer/hooks/host-service/useHostTargetUrl", () => ({
	useHostUrl: (hostId: string) =>
		hostId === "offline" ? null : `http://${hostId}`,
}));
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: (hostUrl: string) => ({
		azureDevOps: {
			getBuildConfig: {
				query: async ({ projectId }: { projectId: string }) =>
					configs.get(`${hostUrl}/${projectId}`) ?? null,
			},
			generateBuild: {
				mutate: async (
					input: AzureBuildOptions & {
						workspaceId: string;
						workItemId: number;
					},
				) => {
					calls.push({ hostUrl, input });
					if (holdBuild)
						await new Promise<void>((resolve) => {
							finishBuild = resolve;
						});
					if (failBuild) throw new Error("Bitrise unavailable");
					return {
						platform: "android",
						lane: input.lane,
						branch: "refactor/381316-aviso-saque",
					};
				},
			},
		},
	}),
}));
const { AzureBuildAction } = await import("./AzureBuildAction");
const workspace: AzureBuildWorkspace = {
	id: "worktree-android",
	hostId: "host-android",
	projectId: "android",
	branch: "refactor/381316-aviso-saque",
};
const config: AzureBuildConfig = {
	projectId: "android",
	platform: "android",
	developerNames: ["Gustavo"],
	alphaVersionValue: "3.15.",
	bitriseTokenConfigured: true,
};
let queryClient: QueryClient;
beforeEach(() => {
	configs.clear();
	configs.set("http://host-android/android", config);
	calls.length = 0;
	failBuild = false;
	holdBuild = false;
	finishBuild = null;
	successToast.mockClear();
	errorToast.mockClear();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
});
afterEach(() => {
	cleanup();
	queryClient.clear();
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});
function mount(item = workspace) {
	return render(
		<QueryClientProvider client={queryClient}>
			<AzureBuildAction
				workspace={item}
				workItemId={381316}
				projectName={item.projectId ?? "unknown"}
			/>
		</QueryClientProvider>,
	);
}
async function buildButton() {
	const page = within(document.body);
	await waitFor(() =>
		expect(
			page.queryByRole("button", { name: "Generate build" }),
		).not.toBeNull(),
	);
	return page.getByRole("button", { name: "Generate build" });
}
describe("Azure worktree build action", () => {
	test.each<AzureBuildConfig | null>([
		null,
		{ ...config, bitriseTokenConfigured: false },
		{ ...config, developerNames: [] },
	])("hides incomplete configuration %j", async (value) => {
		configs.set("http://host-android/android", value);
		mount();
		await waitFor(() =>
			expect(
				queryClient.getQueryState([
					"azure-devops",
					"build-config",
					"http://host-android",
					"android",
				])?.status,
			).toBe("success"),
		);
		expect(
			within(document.body).queryByRole("button", { name: "Generate build" }),
		).toBeNull();
		expect(calls).toHaveLength(0);
	});
	test("starts Alpha once on the clicked worktree's host with no mocks", async () => {
		mount();
		const button = await buildButton();
		expect(calls).toHaveLength(0);
		await act(async () => {
			fireEvent.click(button);
			fireEvent.click(button);
		});
		await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
		expect(calls).toEqual([
			{
				hostUrl: "http://host-android",
				input: {
					workspaceId: workspace.id,
					workItemId: 381316,
					lane: "alpha",
					developerName: "Gustavo",
					addToMocks: false,
				},
			},
		]);
		expect(within(document.body).queryByRole("dialog")).toBeNull();
	});
	test("opens customization from the arrow without triggering a build", async () => {
		mount();
		await buildButton();
		const page = within(document.body);
		await act(async () => {
			fireEvent.click(
				page.getByRole("button", { name: "Customize mobile build" }),
			);
		});
		const dialog = page.getByRole("dialog");
		expect(within(dialog).getByText(workspace.branch)).not.toBeNull();
		expect(within(dialog).getByText("android")).not.toBeNull();
		expect(within(dialog).queryByLabelText("Worktree and branch")).toBeNull();
		expect(calls).toHaveLength(0);
		await act(async () => {
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Start build" }),
			);
		});
		await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
		expect(calls[0]?.input.workspaceId).toBe(workspace.id);
		await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
	});
	test("opens the modal for several developers on the selected project's host", async () => {
		const other = {
			...workspace,
			id: "worktree-ios",
			projectId: "ios",
			hostId: "host-ios",
		};
		configs.set("http://host-ios/ios", {
			...config,
			projectId: "ios",
			platform: "ios",
			developerNames: ["Ana", "Bia"],
		});
		mount(other);
		const button = await buildButton();
		await act(async () => {
			fireEvent.click(button);
		});
		const page = within(document.body);
		expect(page.getByRole("dialog")).not.toBeNull();
		expect(calls).toHaveLength(0);
		await act(async () => {
			fireEvent.click(page.getByRole("button", { name: "Start build" }));
		});
		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0]).toEqual({
			hostUrl: "http://host-ios",
			input: {
				workspaceId: other.id,
				workItemId: 381316,
				lane: "alpha",
				developerName: "Ana",
				versionName: undefined,
				versionNumber: undefined,
				addToMocks: false,
			},
		});
	});
	test.each([
		"beta",
		"release",
	] as const)("customizes Android %s with explicit versions", async (lane) => {
		mount();
		await buildButton();
		const page = within(document.body);
		await act(async () => {
			fireEvent.click(
				page.getByRole("button", { name: "Customize mobile build" }),
			);
		});
		await act(async () => {
			fireEvent.keyDown(page.getByRole("combobox", { name: "Build type" }), {
				key: "ArrowDown",
			});
		});
		await act(async () => {
			fireEvent.click(
				page.getByRole("option", {
					name: lane === "beta" ? "Beta" : "Release",
				}),
			);
		});
		const start = page.getByRole("button", { name: "Start build" });
		expect((start as HTMLButtonElement).disabled).toBe(true);
		await act(async () => {
			fireEvent.change(page.getByRole("textbox", { name: "Version name" }), {
				target: { value: " 3.16.123 " },
			});
		});
		expect((start as HTMLButtonElement).disabled).toBe(true);
		await act(async () => {
			fireEvent.change(page.getByRole("textbox", { name: "Version number" }), {
				target: { value: " 456 " },
			});
			fireEvent.click(start);
		});
		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0]?.input).toEqual({
			workspaceId: workspace.id,
			workItemId: 381316,
			lane,
			developerName: "Gustavo",
			versionName: "3.16.123",
			versionNumber: "456",
			addToMocks: false,
		});
	});
	test("allows Alpha with mocks through customization", async () => {
		mount();
		await buildButton();
		const page = within(document.body);
		await act(async () => {
			fireEvent.click(
				page.getByRole("button", { name: "Customize mobile build" }),
			);
		});
		await act(async () => {
			fireEvent.click(
				page.getByRole("checkbox", { name: "Add this build to mocks" }),
			);
		});
		await act(async () => {
			fireEvent.click(page.getByRole("button", { name: "Start build" }));
		});
		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0]?.input.addToMocks).toBe(true);
	});
	test("blocks both actions while a build is pending", async () => {
		holdBuild = true;
		mount();
		const button = await buildButton();
		await act(async () => {
			fireEvent.click(button);
		});
		await waitFor(() => expect(calls).toHaveLength(1));
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(
			(
				within(document.body).getByRole("button", {
					name: "Customize mobile build",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		await act(async () => {
			finishBuild?.();
		});
		await waitFor(() =>
			expect((button as HTMLButtonElement).disabled).toBe(false),
		);
	});
	test("reports failure and permits manual retry without automatically retrying", async () => {
		failBuild = true;
		mount();
		const button = await buildButton();
		await act(async () => {
			fireEvent.click(button);
		});
		await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
		expect(calls).toHaveLength(1);
		failBuild = false;
		await act(async () => {
			fireEvent.click(button);
		});
		await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
		expect(calls).toHaveLength(2);
	});
	test("reacts to token removal and restored settings in the shared cache", async () => {
		mount();
		await buildButton();
		await act(async () => {
			queryClient.setQueryData(
				["azure-devops", "build-config", "http://host-android", "android"],
				{ ...config, bitriseTokenConfigured: false },
			);
		});
		await waitFor(() =>
			expect(
				within(document.body).queryByRole("button", { name: "Generate build" }),
			).toBeNull(),
		);
		await act(async () => {
			queryClient.setQueryData(
				["azure-devops", "build-config", "http://host-android", "android"],
				config,
			);
		});
		await buildButton();
	});
	test("disables generation for a branch without a work item number", async () => {
		mount({ ...workspace, branch: "feature/no-id" });
		expect(((await buildButton()) as HTMLButtonElement).disabled).toBe(true);
		expect(calls).toHaveLength(0);
	});
});
