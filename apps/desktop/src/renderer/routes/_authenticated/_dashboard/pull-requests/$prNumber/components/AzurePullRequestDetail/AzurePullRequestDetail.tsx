import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { ScrollArea } from "@superset/ui/scroll-area";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	LuExternalLink,
	LuGitBranch,
	LuGitPullRequest,
	LuRefreshCw,
} from "react-icons/lu";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { WorkItemDetailState } from "renderer/routes/_authenticated/_dashboard/components/WorkItemDetailState";
import { AzurePullRequestThreads } from "./components/AzurePullRequestThreads";

type AzurePullRequestDetailProps = {
	projectId: string | null;
	hostUrl: string | null;
	pullRequestId: number | null;
};

export function AzurePullRequestDetail({
	projectId,
	hostUrl,
	pullRequestId,
}: AzurePullRequestDetailProps) {
	const { t } = useLingui();
	const [tab, setTab] = useState<"summary" | "code">("summary");
	const detail = useQuery({
		queryKey: [
			"azure-devops",
			"pull-request",
			hostUrl,
			projectId,
			pullRequestId,
		],
		enabled: Boolean(hostUrl && projectId && pullRequestId),
		queryFn: () =>
			hostUrl && projectId && pullRequestId
				? getHostServiceClientByUrl(hostUrl).azureDevOps.getPullRequest.query({
						projectId,
						pullRequestId,
					})
				: null,
		staleTime: 30_000,
	});
	const diff = useQuery({
		queryKey: [
			"azure-devops",
			"pull-request-diff",
			hostUrl,
			projectId,
			pullRequestId,
		],
		enabled: tab === "code" && Boolean(hostUrl && projectId && pullRequestId),
		queryFn: () =>
			hostUrl && projectId && pullRequestId
				? getHostServiceClientByUrl(
						hostUrl,
					).azureDevOps.getPullRequestDiff.query({ projectId, pullRequestId })
				: null,
		staleTime: 30_000,
	});

	if (!projectId || !hostUrl || pullRequestId === null) {
		return (
			<WorkItemDetailState
				message={t({ message: "Select a project to load this pull request." })}
			/>
		);
	}
	if (detail.isPending) {
		return (
			<WorkItemDetailState
				message={t({ message: "Loading pull request…" })}
				isLoading
			/>
		);
	}
	if (!detail.data || detail.error) {
		return (
			<WorkItemDetailState
				message={
					detail.error instanceof Error
						? detail.error.message
						: t({ message: "Pull request not found." })
				}
				isError
				onRetry={() => void detail.refetch()}
			/>
		);
	}

	const data = detail.data;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="shrink-0 border-b border-border px-5 py-4">
				<div className="flex items-start gap-3">
					<LuGitPullRequest className="mt-1 size-5 text-[#0078d4]" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<Badge
								variant="secondary"
								className="rounded-full font-mono font-normal"
							>
								#{data.number}
							</Badge>
							<Badge variant="outline" className="rounded-full capitalize">
								{data.state}
							</Badge>
							{data.isDraft ? (
								<Badge variant="outline">
									<Trans>Draft</Trans>
								</Badge>
							) : null}
						</div>
						<h1 className="mt-2 text-balance text-lg font-semibold">
							{data.title}
						</h1>
						<p className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
							<LuGitBranch className="size-3.5" />
							{data.branch} <span aria-hidden="true">→</span> {data.baseBranch}
						</p>
					</div>
					<Button variant="outline" size="sm" asChild>
						<a href={data.url} target="_blank" rel="noreferrer">
							<LuExternalLink />
							<Trans>Open in Azure</Trans>
						</a>
					</Button>
				</div>
				<div className="mt-4 flex items-center gap-1">
					{(["summary", "code"] as const).map((value) => (
						<button
							key={value}
							type="button"
							onClick={() => setTab(value)}
							className={cn(
								"min-h-9 rounded-md px-3 text-xs font-medium transition-[background-color,color,transform] active:scale-[0.96]",
								tab === value
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{value === "summary" ? (
								<Trans>Summary</Trans>
							) : (
								<Trans>Code</Trans>
							)}
						</button>
					))}
				</div>
			</header>
			{tab === "summary" ? (
				<ScrollArea className="min-h-0 flex-1">
					<div className="grid gap-8 px-6 py-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
						<div className="min-w-0">
							{data.body.trim() ? (
								<MarkdownRenderer content={data.body} />
							) : (
								<p className="text-sm italic text-muted-foreground">
									<Trans>No description provided.</Trans>
								</p>
							)}
						</div>
						<aside className="space-y-6">
							<div>
								<h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
									<Trans>Reviewers</Trans>
								</h2>
								<div className="mt-2 space-y-2">
									{data.reviewers.map((reviewer) => (
										<div
											key={reviewer.name}
											className="flex items-center justify-between gap-3 text-sm"
										>
											<span className="truncate">{reviewer.name}</span>
											<span className="tabular-nums font-mono text-xs text-muted-foreground">
												{reviewer.vote}
											</span>
										</div>
									))}
								</div>
							</div>
							<div>
								<h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
									<Trans>Policies</Trans>
								</h2>
								<div className="mt-2 space-y-2">
									{data.checks.map((check) => (
										<div
											key={check.name}
											className="flex items-center justify-between gap-3 text-sm"
										>
											<span className="truncate">{check.name}</span>
											<span className="capitalize text-muted-foreground">
												{check.status}
											</span>
										</div>
									))}
								</div>
							</div>
						</aside>
					</div>
				</ScrollArea>
			) : diff.isPending ? (
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					<LuRefreshCw className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
					<Trans>Loading diff…</Trans>
				</div>
			) : (
				<ScrollArea className="min-h-0 flex-1 bg-[#0d1117]">
					<pre className="min-w-max p-5 font-mono text-xs leading-5 text-[#e6edf3]">
						{diff.data?.patch || t({ message: "No changes found." })}
					</pre>
					<AzurePullRequestThreads
						hostUrl={hostUrl}
						projectId={projectId}
						pullRequestId={pullRequestId}
					/>
				</ScrollArea>
			)}
		</div>
	);
}
