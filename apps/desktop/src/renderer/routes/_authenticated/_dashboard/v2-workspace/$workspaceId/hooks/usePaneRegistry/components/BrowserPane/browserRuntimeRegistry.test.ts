import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();

const calls: Array<{ method: string; input: unknown }> = [];
const mutate = mock(async (input: unknown) => {
	calls.push({ method: "mutate", input });
	return {
		success: true,
		pane: {
			paneId: "pane-1",
			workspaceId: "workspace-1",
			url: "https://example.com",
			title: "Example",
			isLoading: false,
			canGoBack: false,
			canGoForward: false,
			zoomFactor: 1,
		},
	};
});

mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {
		browser: {
			register: { mutate },
			unregister: { mutate },
			onAgentActivePanes: { subscribe: () => ({ unsubscribe: () => {} }) },
			onPaneFocus: { subscribe: () => ({ unsubscribe: () => {} }) },
			setBounds: { mutate },
			setVisibility: { mutate },
			navigate: { mutate },
			goBack: { mutate },
			goForward: { mutate },
			reload: { mutate },
			setZoom: { mutate },
			findInPage: { mutate },
			stopFindInPage: { mutate },
			print: { mutate },
			onPaneState: { subscribe: () => ({ unsubscribe: () => {} }) },
			onFoundInPage: { subscribe: () => ({ unsubscribe: () => {} }) },
		},
		browserHistory: { upsert: { mutate } },
	},
}));

const { browserRuntimeRegistry } = await import("./browserRuntimeRegistry");

afterEach(() => {
	calls.length = 0;
	browserRuntimeRegistry.destroy("pane-1");
});

describe("native browser runtime registry", () => {
	test("registers a CEF child view and updates native bounds", async () => {
		const placeholder = document.createElement("div");
		Object.defineProperty(placeholder, "getBoundingClientRect", {
			value: () => ({ left: 10, top: 20, width: 640, height: 480 }),
		});
		browserRuntimeRegistry.attach(
			"pane-1",
			placeholder,
			"https://example.com",
			"workspace-1",
			() => {},
			() => {},
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			calls.some(
				({ input }) => (input as { paneId?: string }).paneId === "pane-1",
			),
		).toBe(true);
		expect(browserRuntimeRegistry.getState("pane-1").currentUrl).toContain(
			"example.com",
		);
	});
});
