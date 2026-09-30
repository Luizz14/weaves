import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { formatCompactRelativeTime } from "@superset/i18n/format";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LuSparkles } from "react-icons/lu";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

interface WorkspaceRecentActivityProps {
	workspaceId: string;
	hostId: string;
}

type RecentActivity = Awaited<
	ReturnType<
		ReturnType<
			typeof getHostServiceClientByUrl
		>["workspace"]["recentActivity"]["query"]
	>
>;

export function WorkspaceRecentActivity({
	workspaceId,
	hostId,
}: WorkspaceRecentActivityProps) {
	const { t } = useLingui();
	const hostUrl = useHostUrl(hostId);
	const queryClient = useQueryClient();
	const queryKey = ["workspace", "recent-activity", hostUrl, workspaceId];
	const activity = useQuery({
		queryKey,
		enabled: hostUrl !== null,
		queryFn: () =>
			hostUrl
				? getHostServiceClientByUrl(hostUrl).workspace.recentActivity.query({
						workspaceId,
					})
				: null,
		staleTime: 30_000,
		retry: false,
	});
	const summarize = useMutation({
		mutationFn: () => {
			if (!hostUrl) throw new Error("Host is offline");
			return getHostServiceClientByUrl(
				hostUrl,
			).quickAi.summarizeWorkspace.mutate({ workspaceId });
		},
		onSuccess: (result) => {
			queryClient.setQueryData<RecentActivity | null>(queryKey, (previous) =>
				previous ? { ...previous, ...result } : previous,
			);
		},
		onError: (error) => {
			toast.error(
				t({
					message: `Couldn't summarize the workspace: ${errorMessage(error)}`,
				}),
			);
		},
	});

	const data = activity.data;
	if (!data) return null;
	const { prompts, summary, summaryUpdatedAt, externalWorkItem } = data;
	const workItemId =
		externalWorkItem?.provider === "azure-devops" ? externalWorkItem.id : null;

	return (
		<div className="space-y-1.5 border-t border-border pt-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
					<Trans>Recent activity</Trans>
				</span>
				<button
					type="button"
					disabled={summarize.isPending}
					onClick={() => summarize.mutate()}
					className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
				>
					<LuSparkles className="size-3" />
					{summarize.isPending ? (
						<Trans>Summarizing…</Trans>
					) : summary ? (
						<Trans>Refresh summary</Trans>
					) : (
						<Trans>Summarize</Trans>
					)}
				</button>
			</div>
			{workItemId && (
				<Link
					to="/tasks/azure/$workItemId"
					params={{ workItemId }}
					search={{ type: "azure", azureHost: hostId }}
					className="block font-mono text-[11px] text-muted-foreground hover:text-foreground"
				>
					#{workItemId}
				</Link>
			)}
			{summary && (
				<p className="text-xs leading-snug">
					{summary}
					{summaryUpdatedAt !== null && (
						<span className="text-muted-foreground">
							{" · "}
							{formatCompactRelativeTime(summaryUpdatedAt)}
						</span>
					)}
				</p>
			)}
			{prompts.length > 0 ? (
				<ul className="space-y-1">
					{prompts.map((prompt, index) => (
						<li
							key={`${index}-${prompt.at ?? ""}`}
							className="flex gap-1.5 text-xs text-muted-foreground"
						>
							<span className="shrink-0 select-none">›</span>
							<span className="line-clamp-2 break-words">{prompt.text}</span>
						</li>
					))}
				</ul>
			) : (
				!summary && (
					<p className="text-xs text-muted-foreground">
						<Trans>No agent requests yet</Trans>
					</p>
				)
			)}
		</div>
	);
}
