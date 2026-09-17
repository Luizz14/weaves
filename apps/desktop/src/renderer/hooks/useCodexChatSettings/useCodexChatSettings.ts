import { DEFAULT_CODEX_CHAT_SETTINGS } from "@superset/shared/codex-chat-settings";
import { electronTrpc } from "renderer/lib/electron-trpc";
export function useCodexChatSettings() {
	const query = electronTrpc.settings.getCodexChat.useQuery();
	return { ...query, settings: query.data ?? DEFAULT_CODEX_CHAT_SETTINGS };
}
