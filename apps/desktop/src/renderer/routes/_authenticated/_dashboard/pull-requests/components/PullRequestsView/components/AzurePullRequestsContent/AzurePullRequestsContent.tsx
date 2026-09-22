import { Trans, useLingui } from "@lingui/react/macro";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { LuGitMerge, LuGitPullRequest, LuRefreshCw } from "react-icons/lu";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { ProjectQueryTarget } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";

type AzurePullRequestsContentProps = {
	projectTargets: ProjectQueryTarget[];
	searchQuery: string;
	includeClosed: boolean;
};

export function AzurePullRequestsContent({
	projectTargets,
	searchQuery,
	includeClosed,
}: AzurePullRequestsContentProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const targets = useMemo(
		() =>
			projectTargets.flatMap((target) =>
				target.hostUrl
					? [
							{
								projectId: target.projectId,
								projectName: target.projectName,
								hostUrl: target.hostUrl,
							},
						]
					: [],
			),
		[projectTargets],
	);
	const queries = useQueries({
		queries: targets.map((target) => ({
			queryKey: [
				"azure-devops",
				"pull-requests",
				target.hostUrl,
				target.projectId,
				includeClosed,
			],
			queryFn: () =>
				getHostServiceClientByUrl(
					target.hostUrl,
				).azureDevOps.listPullRequests.query({
					projectId: target.projectId,
					includeClosed,
					page: 1,
					limit: 100,
				}),
			staleTime: 30_000,
			retry: false,
		})),
	});
	const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
	const rows = queries
		.flatMap((query, index) => {
			const target = targets[index];
			return (query.data?.items ?? []).map((item) => ({
				...item,
				projectName: target?.projectName ?? item.projectId,
			}));
		})
		.filter(
			(item) =>
				!normalizedSearch ||
				item.title.toLocaleLowerCase().includes(normalizedSearch) ||
				item.author.toLocaleLowerCase().includes(normalizedSearch) ||
				String(item.number).includes(normalizedSearch),
		)
		.sort((left, right) =>
			(right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
		);
	const isFetching = queries.some((query) => query.isFetching);
	const error = queries.find((query) => query.error)?.error;

	if (targets.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
				<Trans>Select an Azure-enabled project to see pull requests.</Trans>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
				<LuGitPullRequest className="size-3.5" />
				<span className="tabular-nums">{rows.length}</span>
				<span>
					<Trans>Azure pull requests</Trans>
				</span>
				{isFetching ? (
					<LuRefreshCw className="ml-auto size-3.5 animate-spin motion-reduce:animate-none" />
				) : null}
			</div>
			{error ? (
				<div className="border-b border-border bg-destructive/8 px-3 py-2 text-xs text-destructive">
					{error instanceof Error
						? error.message
						: t({ message: "Failed to load pull requests" })}
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{rows.map((item) => {
					const merged = item.state === "merged";
					const StateIcon = merged ? LuGitMerge : LuGitPullRequest;
					return (
						<button
							key={`${item.projectId}:${item.number}`}
							type="button"
							className="flex min-h-16 w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-[background-color] hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
							onClick={() =>
								navigate({
									to: "/pull-requests/$prNumber",
									params: { prNumber: String(item.number) },
									search: {
										provider: "azure-devops",
										project: item.projectId,
									},
								})
							}
						>
							<StateIcon
								className={
									merged
										? "mt-0.5 size-4 text-violet-500"
										: "mt-0.5 size-4 text-emerald-500"
								}
							/>
							<div className="min-w-0 flex-1">
								<p className="line-clamp-2 text-pretty text-sm font-medium">
									{item.title}
								</p>
								<p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
									{item.projectName} · #{item.number} · {item.author}
								</p>
							</div>
						</button>
					);
				})}
				{rows.length === 0 && !isFetching ? (
					<div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
						<Trans>No Azure pull requests found.</Trans>
					</div>
				) : null}
			</div>
		</div>
	);
}
