import type { ChatTransport } from "@superset/chat/client";
import { useQuery } from "@tanstack/react-query";
export function useCodexModels(
	transport: ChatTransport | null,
	hostKey: string | null,
) {
	return useQuery({
		queryKey: ["codex-models", hostKey],
		enabled: Boolean(transport),
		staleTime: 60000,
		queryFn: async () => {
			if (!transport?.listCodexModels)
				throw new Error("Codex model discovery is unavailable");
			return transport.listCodexModels(undefined);
		},
	});
}
