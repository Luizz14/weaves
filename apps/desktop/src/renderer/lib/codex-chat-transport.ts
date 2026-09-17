import type { ChatTransport } from "@superset/chat/client";
import type { ChatRouter } from "@superset/chat-runtime";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { getHostServiceHeaders } from "renderer/lib/host-service-auth";
export function createCodexChatTransport(hostUrl: string): ChatTransport {
	const client = createTRPCClient<ChatRouter>({
		links: [
			httpBatchLink({
				url: `${hostUrl}/chat-v3/trpc`,
				headers: () => getHostServiceHeaders(hostUrl),
			}),
		],
	});
	const transport: ChatTransport = {
		listCodexModels: () => client.listCodexModels.query(),
		configureCodex: (input) => client.configureCodex.mutate(input),
		updateCodexGoal: (input) => client.updateCodexGoal.mutate(input),
		respondToUserInput: (input) => client.respondToUserInput.mutate(input),
		setLinkedWorkspaces: (input) => client.setLinkedWorkspaces.mutate(input),
		createSession: (input) => client.createSession.mutate(input),
		prompt: (input) => client.prompt.mutate(input),
		cancelTurn: (input) => client.cancelTurn.mutate(input),
		respondToApproval: (input) => client.respondToApproval.mutate(input),
		setMode: (input) => client.setMode.mutate(input),
		getSession: (input) => client.getSession.query(input),
		listSessions: (input) => client.listSessions.query(input),
		getItems: (input) => client.getItems.query(input),
	};
	return transport;
}
