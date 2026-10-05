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
import type { ReactNode } from "react";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const configs = new Map<string, { workItemProject: string } | null>();
const queriedHosts: string[] = [];
let localHostId: string | null = "local";
let otherHosts: Array<{ id: string; isOnline: boolean }> = [];
mock.module("renderer/hooks/host-service/useHostTargetUrl", () => ({
	useHostUrls: (hostIds: string[]) =>
		hostIds.map((hostId) => ({
			hostId,
			url: `http://${hostId}`,
			isLocal: hostId === localHostId,
		})),
}));
mock.module(
	"renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions",
	() => ({ useWorkspaceHostOptions: () => ({ localHostId, otherHosts }) }),
);
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: (url: string) => ({
		azureDevOps: {
			getBoardConfig: {
				query: async () => {
					queriedHosts.push(url);
					return configs.get(url) ?? null;
				},
			},
		},
	}),
}));
const { useAzureDevOpsBoardAvailability } = await import(
	"./useAzureDevOpsBoardAvailability"
);
let client: QueryClient;
beforeEach(() => {
	configs.clear();
	queriedHosts.length = 0;
	localHostId = "local";
	otherHosts = [];
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
	cleanup();
	client.clear();
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});
function mount() {
	return renderHook(useAzureDevOpsBoardAvailability, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}
describe("organization Azure board availability", () => {
	test("does not expose settings before integration is confirmed", async () => {
		const { result } = mount();
		expect(result.current.hasConfiguredBoard).toBe(false);
		await waitFor(() => expect(result.current.isReady).toBe(true));
		expect(result.current.hasConfiguredBoard).toBe(false);
		expect(result.current.isLoading).toBe(false);
	});
	test("recognizes an integration configured only on another online host", async () => {
		otherHosts = [{ id: "remote", isOnline: true }];
		configs.set("http://remote", { workItemProject: "Mobile" });
		const { result } = mount();
		await waitFor(() => expect(result.current.hasConfiguredBoard).toBe(true));
		expect(result.current.configuredTarget?.hostId).toBe("remote");
		expect(queriedHosts.sort()).toEqual(["http://local", "http://remote"]);
	});
	test("ignores offline hosts and deduplicates the local host", async () => {
		otherHosts = [
			{ id: "offline", isOnline: false },
			{ id: "local", isOnline: true },
		];
		configs.set("http://offline", { workItemProject: "Mobile" });
		const { result } = mount();
		await waitFor(() => expect(result.current.isReady).toBe(true));
		expect(result.current.hasConfiguredBoard).toBe(false);
		expect(queriedHosts).toEqual(["http://local"]);
	});
	test("updates visibility when integration settings remove or add a board", async () => {
		configs.set("http://local", { workItemProject: "Mobile" });
		const { result } = mount();
		await waitFor(() => expect(result.current.hasConfiguredBoard).toBe(true));
		await act(async () => {
			client.setQueryData(
				["azure-devops", "board-config", "local", "http://local"],
				null,
			);
		});
		await waitFor(() => expect(result.current.hasConfiguredBoard).toBe(false));
		configs.set("http://local", { workItemProject: "Mobile" });
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ["azure-devops", "board-config"],
			});
		});
		await waitFor(() => expect(result.current.hasConfiguredBoard).toBe(true));
	});
	test("settles without an integration when no hosts are available", () => {
		localHostId = null;
		const { result } = mount();
		expect(result.current.hasConfiguredBoard).toBe(false);
		expect(result.current.isReady).toBe(true);
		expect(result.current.isLoading).toBe(false);
	});
});
