import { createFileRoute } from "@tanstack/react-router";
import { CodexChatSettingsPage } from "./components/CodexChatSettingsPage/CodexChatSettingsPage";
export const Route = createFileRoute("/_authenticated/settings/codex-chat/")({
	component: CodexChatSettingsPage,
});
