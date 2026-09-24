import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { AzureDevOpsBoardResult } from "renderer/routes/_authenticated/_dashboard/tasks/components/TasksView/components/AzureDevOpsContent/types";

/**
 * The work item's title, shared with the detail page's query (same key) so a
 * visited item never refetches; the board cache answers first when present.
 */
export function useUserStoryTitle(
	workItemId: number,
	hostId: string,
): string | null {
	const queryClient = useQueryClient();
	const hostUrl = useHostUrl(hostId);
	const boardTitle = hostUrl
		? queryClient
				.getQueriesData<AzureDevOpsBoardResult>({
					queryKey: ["azure-devops", "board", hostUrl],
				})
				.map(([, board]) => board?.items.find((item) => item.id === workItemId))
				.find((item) => item !== undefined)?.title
		: undefined;
	const workItemQuery = useQuery({
		queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
		enabled: hostUrl !== null && !boardTitle,
		queryFn: () =>
			hostUrl
				? getHostServiceClientByUrl(hostUrl).azureDevOps.getWorkItem.query({
						workItemId,
					})
				: null,
		staleTime: Number.POSITIVE_INFINITY,
		refetchInterval: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		retry: false,
	});
	const fieldTitle = workItemQuery.data?.item.fields["System.Title"];
	return boardTitle ?? (typeof fieldTitle === "string" ? fieldTitle : null);
}
