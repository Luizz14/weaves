import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, fireEvent, waitFor, cleanup } = await import(
	"@testing-library/react"
);
const createSession = mock(async (_input: unknown) => ({
	sessionId: "new-session",
	epoch: "epoch",
}));
const onSessionIdChange = mock((_id: string | null) => undefined);
mock.module("../../hooks/useSessionClient", () => ({
	useChatWiring: () => ({ transport: {}, streamBaseUrl: "test" }),
	useSessionClient(id: string | null) {
		return {
			client: id ? { sessionId: id } : null,
			wiring: {
			transport: {
				createSession,
				async setLinkedWorkspaces() {
					return [];
				},
				async configureCodex(input: { execution: unknown }) {
						return input.execution;
					},
					async setMode() {},
				},
				streamBaseUrl: "http://host/chat-v3",
			},
		};
	},
}));
mock.module("./hooks/useLinkableWorkspaces", () => ({
	useLinkableWorkspaces: () => ({
		workspaces: [
			{
				id: "workspace-2",
				name: "Other workspace",
				branch: "feature/other",
				projectId: null,
				projectName: "Other workspace",
			},
		],
		isLoading: false,
	}),
}));
mock.module("./components/CodexSession/CodexSession", () => ({
	CodexSession: ({ client }: { client: { sessionId: string } }) => (
		<div data-testid="session">{client.sessionId}</div>
	),
}));
const { DEFAULT_CODEX_CHAT_SETTINGS } = await import(
	"@superset/shared/codex-chat-settings"
);
mock.module("renderer/hooks/useCodexChatSettings", () => ({
	useCodexChatSettings: () => ({
		settings: DEFAULT_CODEX_CHAT_SETTINGS,
		isPending: false,
		error: null,
	}),
}));
mock.module("renderer/hooks/useCodexModels", () => ({
	useCodexModels: () => ({
		data: DEFAULT_CODEX_CHAT_SETTINGS.presets.map((preset) => ({
			model: preset.modelId,
			supportedReasoningEfforts: [
				{ reasoningEffort: "low" },
				{ reasoningEffort: "medium" },
				{ reasoningEffort: "max" },
			],
			serviceTiers: [{ id: "priority", description: "Fast" }],
		})),
		error: null,
	}),
}));
const routerModule = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...routerModule,
	Link: ({ children }: { children: ReactNode }) => (
		<a href="/settings/codex-chat">{children}</a>
	),
}));
const { CodexChatPane } = await import("./CodexChatPane");
afterEach(() => {
	cleanup();
	createSession.mockClear();
	onSessionIdChange.mockClear();
});
describe("CodexChatPane", () => {
	test("offers linking another workspace before the first prompt", async () => {
		const view = render(
			<CodexChatPane
				workspaceId="workspace"
				sessionId={null}
				onSessionIdChange={onSessionIdChange}
			/>,
		);
		fireEvent.click(await view.findByRole("button", { name: "Add" }));
		expect(await view.findByText("Link workspaces")).toBeTruthy();
	});

	test("creates a Codex session with automatic permissions and guards repeated submission", async () => {
		let complete:
			| ((value: { sessionId: string; epoch: string }) => void)
			| undefined;
		createSession.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const view = render(
			<CodexChatPane
				workspaceId="workspace"
				sessionId={null}
				onSessionIdChange={onSessionIdChange}
			/>,
		);
		const input = view.getByRole("textbox");
		fireEvent.change(input, { target: { value: "hello" } });
		fireEvent.keyDown(input, { key: "Enter" });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
		expect(createSession.mock.calls[0]?.[0]).toMatchObject({
			workspaceId: "workspace",
			harness: "codex",
			modeId: "auto",
		});
		complete?.({ sessionId: "new-session", epoch: "epoch" });
		await waitFor(() =>
			expect(onSessionIdChange).toHaveBeenCalledWith("new-session"),
		);
	});
	test("keeps the draft and reuses the command id when creation fails", async () => {
		createSession.mockRejectedValueOnce(new Error("Host offline"));
		const view = render(
			<CodexChatPane
				workspaceId="workspace"
				sessionId={null}
				onSessionIdChange={onSessionIdChange}
			/>,
		);
		const input = view.getByRole("textbox") as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "keep my prompt" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain("Host offline"),
		);
		expect(input.value).toBe("keep my prompt");
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
		expect(createSession.mock.calls[0]?.[0]).toEqual(
			createSession.mock.calls[1]?.[0],
		);
	});
	test("opens the persisted session instead of creating another one", () => {
		const view = render(
			<CodexChatPane
				workspaceId="workspace"
				sessionId="saved"
				onSessionIdChange={onSessionIdChange}
			/>,
		);
		expect(view.getByTestId("session").textContent).toBe("saved");
		expect(createSession).not.toHaveBeenCalled();
	});
});
