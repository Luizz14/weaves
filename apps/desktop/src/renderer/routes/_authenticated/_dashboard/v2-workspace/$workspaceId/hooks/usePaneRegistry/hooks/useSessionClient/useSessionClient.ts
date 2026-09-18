import type {
	ChatTransport,
	SessionClient,
	StreamSocket,
} from "@superset/chat/client";
import { createSessionClient } from "@superset/chat/client";
import { useWorkspaceClient } from "@superset/workspace-client";
import { useEffect, useMemo } from "react";
import { createCodexChatTransport } from "renderer/lib/codex-chat-transport";

export type ChatWiring = {
	transport: ChatTransport;
	streamBaseUrl: string;
	/** The host that owns this session — also where attachments upload. */
	hostUrl: string;
	createSocket: (url: string) => StreamSocket;
};

export function useChatWiring(): ChatWiring {
	const { getWsToken, hostUrl } = useWorkspaceClient();

	return useMemo(() => {
		const transport = createCodexChatTransport(hostUrl);
		const createSocket = (url: string): StreamSocket => {
			const wsUrl = new URL(url);
			wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
			const token = getWsToken();
			if (token) wsUrl.searchParams.set("token", token);
			return new WebSocket(wsUrl.toString());
		};
		return {
			transport,
			streamBaseUrl: `${hostUrl}/chat-v3`,
			hostUrl,
			createSocket,
		};
	}, [hostUrl, getWsToken]);
}

export function useSessionClient(sessionId: string | null): {
	client: SessionClient | null;
	wiring: ChatWiring;
} {
	const wiring = useChatWiring();
	const client = useMemo(
		() =>
			sessionId
				? createSessionClient({
						sessionId,
						transport: wiring.transport,
						streamBaseUrl: wiring.streamBaseUrl,
						createSocket: wiring.createSocket,
					})
				: null,
		[sessionId, wiring],
	);

	useEffect(() => {
		return () => {
			client?.close();
		};
	}, [client]);

	return { client, wiring };
}
