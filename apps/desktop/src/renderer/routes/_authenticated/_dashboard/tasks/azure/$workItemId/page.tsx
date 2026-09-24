import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { ScrollArea } from "@superset/ui/scroll-area";
import { Skeleton } from "@superset/ui/skeleton";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
	LuArrowLeft,
	LuExternalLink,
	LuFileText,
	LuHammer,
	LuLink,
	LuPlus,
	LuRefreshCw,
} from "react-icons/lu";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import type { AzureDevOpsBoardResult } from "../../components/TasksView/components/AzureDevOpsContent/types";
import { Route as TasksLayoutRoute } from "../../layout";
import { AzureWorktreeRow } from "./components/AzureWorktreeRow";
import { CreateAzureWorktreeDialog } from "./components/CreateAzureWorktreeDialog";
import { GenerateAzureBuildDialog } from "./components/GenerateAzureBuildDialog";
import { LinkExistingWorktreeDialog } from "./components/LinkExistingWorktreeDialog";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/tasks/azure/$workItemId/",
)({
	component: AzureWorkItemDetailPage,
});

function stringField(
	fields: Record<string, unknown>,
	name: string,
): string | null {
	const value = fields[name];
	return typeof value === "string" ? value : null;
}

function identityName(
	fields: Record<string, unknown>,
	name: string,
): string | null {
	const value = fields[name];
	if (typeof value !== "object" || value === null) return null;
	const displayName = Reflect.get(value, "displayName");
	return typeof displayName === "string" ? displayName : null;
}

function relationId(url: string): number | null {
	const match = /\/workItems\/(\d+)(?:\?|$)/i.exec(url);
	const value = match?.[1] ? Number(match[1]) : Number.NaN;
	return Number.isInteger(value) ? value : null;
}

function AzureWorkItemDetailPage() {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { workItemId: workItemIdRaw } = Route.useParams();
	const search = TasksLayoutRoute.useSearch();
	const workItemId = Number(workItemIdRaw);
	const configuredHostUrl = useHostUrl(search.azureHost);
	const { activeHostUrl } = useLocalHostService();
	const hostUrl = configuredHostUrl ?? activeHostUrl;
	const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
	const [buildDialogOpen, setBuildDialogOpen] = useState(false);
	const cachedBoardItem = hostUrl
		? queryClient
				.getQueriesData<AzureDevOpsBoardResult>({
					queryKey: ["azure-devops", "board", hostUrl],
				})
				.map(([, board]) => board?.items.find((item) => item.id === workItemId))
				.find((item) => item !== undefined)
		: undefined;
	const workItemQuery = useQuery({
		queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
		enabled: hostUrl !== null && Number.isInteger(workItemId),
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
	});
	const claimQuery = useQuery({
		queryKey: ["azure-devops", "work-item-claim", hostUrl, workItemId],
		enabled: hostUrl !== null && Number.isInteger(workItemId),
		queryFn: () =>
			hostUrl
				? getHostServiceClientByUrl(hostUrl).azureDevOps.getWorkItemClaim.query(
						{
							workItemId,
						},
					)
				: null,
		staleTime: Number.POSITIVE_INFINITY,
		refetchInterval: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	});
	const { workspaces } = useHostWorkspaces();
	const { projects } = useHostProjects();
	const linkedWorkspaces = useMemo(
		() =>
			workspaces.filter(
				(workspace) =>
					workspace.externalWorkItemProvider === "azure-devops" &&
					workspace.externalWorkItemId === String(workItemId),
			),
		[workItemId, workspaces],
	);
	const projectNameById = useMemo(
		() =>
			new Map(projects.map((project) => [project.projectKey, project.name])),
		[projects],
	);
	const unknownProjectLabel = t({ message: "Unknown project" });
	const projectName = useCallback(
		(projectId: string | null) =>
			projectId
				? (projectNameById.get(projectId) ?? projectId)
				: unknownProjectLabel,
		[projectNameById, unknownProjectLabel],
	);
	const [linkDialogOpen, setLinkDialogOpen] = useState(false);
	const claim = useMutation({
		mutationFn: async () => {
			if (!hostUrl) throw new Error("Azure DevOps host is unavailable");
			const iterationPath =
				stringField(
					workItemQuery.data?.item.fields ?? {},
					"System.IterationPath",
				) ?? cachedBoardItem?.iterationPath;
			if (!iterationPath) throw new Error("Work item has no iteration");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.claimWorkItem.mutate({
				workItemId,
				iterationPath,
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
			});
			void queryClient.invalidateQueries({
				queryKey: ["azure-devops", "work-item-claim", hostUrl, workItemId],
			});
		},
		onError: (error) => toast.error(errorMessage(error)),
	});
	const setStage = useMutation({
		mutationFn: async (stage: "implementation" | "homologation" | "review") => {
			if (!hostUrl) throw new Error("Azure DevOps host is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.setWorkItemStage.mutate({ workItemId, stage });
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
			});
			void queryClient.invalidateQueries({
				queryKey: ["azure-devops", "work-item-claim", hostUrl, workItemId],
			});
		},
		onError: (error) => toast.error(errorMessage(error)),
	});

	if (!Number.isInteger(workItemId)) {
		return (
			<div className="p-6 text-sm text-destructive">
				<Trans>Invalid work item</Trans>
			</div>
		);
	}
	if (
		!workItemQuery.data &&
		!cachedBoardItem &&
		(workItemQuery.error || !workItemQuery.isPending)
	) {
		return (
			<div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
				{workItemQuery.error
					? errorMessage(workItemQuery.error)
					: t({ message: "Work item not found" })}
			</div>
		);
	}

	const item = workItemQuery.data?.item;
	const fields = item?.fields ?? {};
	const workItemClaim = claimQuery.isSuccess
		? claimQuery.data?.claim
		: cachedBoardItem?.claim;
	const stage =
		workItemQuery.data?.stage ??
		claimQuery.data?.stage ??
		cachedBoardItem?.stage ??
		null;
	const isReadOnly = Boolean(workItemClaim && !workItemClaim.isCurrentUser);
	const title =
		stringField(fields, "System.Title") ??
		cachedBoardItem?.title ??
		`AB#${workItemId}`;
	const type =
		stringField(fields, "System.WorkItemType") ??
		cachedBoardItem?.type ??
		t({ message: "Work item" });
	const azureState =
		stringField(fields, "System.State") ?? cachedBoardItem?.state ?? "Unknown";
	const iteration =
		stringField(fields, "System.IterationPath") ??
		cachedBoardItem?.iterationPath ??
		null;
	const assignedTo =
		identityName(fields, "System.AssignedTo") ??
		cachedBoardItem?.assignedTo?.displayName ??
		null;
	const createdBy = identityName(fields, "System.CreatedBy");
	const tags = (
		stringField(fields, "System.Tags") ??
		cachedBoardItem?.tags.join(";") ??
		""
	)
		.split(";")
		.map((tag) => tag.trim())
		.filter(Boolean);
	const description =
		stringField(fields, "System.Description") ??
		stringField(fields, "Microsoft.VSTS.TCM.ReproSteps") ??
		"";
	const relations = item?.relations ?? [];
	const relatedWork = relations.filter((relation) =>
		[
			"System.LinkTypes.Hierarchy-Forward",
			"System.LinkTypes.Hierarchy-Reverse",
		].includes(relation.rel),
	);
	const attachments = relations.filter(
		(relation) => relation.rel === "AttachedFile",
	);
	const stageLabel = {
		backlog: t({ message: "Backlog" }),
		implementation: t({ message: "Implementation" }),
		homologation: t({ message: "Homologation" }),
		review: t({ message: "Review" }),
	}[stage ?? "backlog"];
	const claimResolved = claimQuery.isSuccess && !claimQuery.isFetching;
	const isRefreshing = workItemQuery.isFetching || claimQuery.isFetching;
	const webUrl = workItemQuery.data?.webUrl ?? cachedBoardItem?.url ?? "";
	const refreshWorkItem = () => {
		void Promise.all([workItemQuery.refetch(), claimQuery.refetch()]);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
				<Button
					type="button"
					variant="ghost"
					size="icon-lg"
					onClick={() =>
						navigate({
							to: "/tasks",
							search: {
								type: "azure",
								azureHost: search.azureHost,
								iteration: search.iteration,
							},
						})
					}
					aria-label={t({ message: "Back to board" })}
				>
					<LuArrowLeft />
				</Button>
				<span className="font-mono text-xs text-muted-foreground">
					AB#{workItemId}
				</span>
				<div className="h-4 w-px bg-border" />
				{stage ? (
					<span className="text-xs text-muted-foreground">{stageLabel}</span>
				) : (
					<Skeleton className="h-4 w-24" />
				)}
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="icon-lg"
					aria-label={t({ message: "Refresh" })}
					title={t({ message: "Refresh" })}
					disabled={isRefreshing}
					onClick={refreshWorkItem}
				>
					<LuRefreshCw
						className={
							isRefreshing
								? "animate-spin motion-reduce:animate-none"
								: undefined
						}
					/>
				</Button>
				{webUrl ? (
					<Button variant="ghost" size="sm" asChild>
						<a href={webUrl} target="_blank" rel="noreferrer">
							<LuExternalLink />
							<Trans>Open in Azure</Trans>
						</a>
					</Button>
				) : (
					<Skeleton className="h-8 w-28" />
				)}
			</header>
			<ScrollArea className="min-h-0 flex-1">
				<div className="mx-auto w-full max-w-5xl px-6 py-7">
					{workItemQuery.error ? (
						<div className="mb-5 rounded-lg bg-destructive/8 px-4 py-3 text-sm text-destructive">
							{errorMessage(workItemQuery.error)}
						</div>
					) : null}
					<div className="flex flex-wrap gap-2">
						{item || cachedBoardItem ? (
							<>
								<Badge
									variant="secondary"
									className="rounded-full font-mono font-normal"
								>
									{type}
								</Badge>
								<Badge
									variant="secondary"
									className="rounded-full font-mono font-normal"
								>
									{azureState}
								</Badge>
							</>
						) : (
							<>
								<Skeleton className="h-6 w-24 rounded-full" />
								<Skeleton className="h-6 w-20 rounded-full" />
							</>
						)}
						{isReadOnly ? (
							<Badge variant="outline" className="rounded-full font-normal">
								{workItemClaim?.assignedTo?.displayName ?? (
									<Trans>Claimed in Azure DevOps</Trans>
								)}
							</Badge>
						) : null}
						{tags.map((tag) => (
							<Badge
								key={tag}
								variant="outline"
								className="rounded-full font-mono font-normal"
							>
								{tag}
							</Badge>
						))}
					</div>
					{item || cachedBoardItem ? (
						<h1 className="mt-4 max-w-4xl text-balance font-serif text-3xl leading-tight">
							{title}
						</h1>
					) : (
						<Skeleton className="mt-4 h-10 w-3/4" />
					)}
					<section className="mt-8 grid gap-x-10 gap-y-3 sm:grid-cols-2">
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Sprint</Trans>
							</span>
							{iteration ? (
								<span>{iteration}</span>
							) : item ? (
								<span>—</span>
							) : (
								<Skeleton className="h-4 w-40" />
							)}
						</div>
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Stage</Trans>
							</span>
							{stage ? (
								<span>{stageLabel}</span>
							) : (
								<Skeleton className="h-4 w-24" />
							)}
						</div>
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Assigned to</Trans>
							</span>
							{assignedTo ? (
								<span>{assignedTo}</span>
							) : item || cachedBoardItem ? (
								<span>—</span>
							) : (
								<Skeleton className="h-4 w-32" />
							)}
						</div>
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Created by</Trans>
							</span>
							{item ? (
								<span>{createdBy ?? "—"}</span>
							) : (
								<Skeleton className="h-4 w-32" />
							)}
						</div>
					</section>

					<section className="mt-10">
						<h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
							<Trans>Description</Trans>
						</h2>
						<div className="mt-3 min-h-16 text-sm">
							{!item ? (
								<div className="space-y-3 py-1">
									<Skeleton className="h-4 w-full" />
									<Skeleton className="h-4 w-11/12" />
									<Skeleton className="h-4 w-4/5" />
								</div>
							) : description ? (
								<MarkdownRenderer content={description} allowHtml />
							) : (
								<p className="text-muted-foreground">
									<Trans>No description provided.</Trans>
								</p>
							)}
						</div>
					</section>

					{!item || relatedWork.length > 0 || attachments.length > 0 ? (
						<section className="mt-10">
							<h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
								<Trans>Related work</Trans>
							</h2>
							{!item ? (
								<div className="mt-3 grid gap-3 sm:grid-cols-2">
									<Skeleton className="h-14 w-full rounded-xl" />
									<Skeleton className="h-14 w-full rounded-xl" />
								</div>
							) : (
								<div className="mt-3 grid gap-3 sm:grid-cols-2">
									{relatedWork.map((relation) => (
										<a
											key={`${relation.rel}:${relation.url}`}
											href={relation.url}
											target="_blank"
											rel="noreferrer"
											className="flex min-h-14 items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm shadow-[0_0_0_1px_var(--border)] transition-[background-color,transform] hover:bg-muted active:scale-[0.96]"
										>
											<LuLink className="size-4 text-muted-foreground" />
											<span>
												{relation.attributes?.name?.toString() ??
													t({ message: "Work item" })}{" "}
												#{relationId(relation.url) ?? ""}
											</span>
										</a>
									))}
									{attachments.map((relation) => (
										<a
											key={relation.url}
											href={relation.url}
											target="_blank"
											rel="noreferrer"
											className="flex min-h-14 items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm shadow-[0_0_0_1px_var(--border)] transition-[background-color,transform] hover:bg-muted active:scale-[0.96]"
										>
											<LuFileText className="size-4 text-muted-foreground" />
											<span>
												{relation.attributes?.name?.toString() ??
													t({ message: "Attachment" })}
											</span>
										</a>
									))}
								</div>
							)}
						</section>
					) : null}

					<section className="mt-10 border-t border-border pt-6">
						<div className="flex items-center justify-between gap-4">
							<div>
								<h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
									<Trans>Worktrees</Trans>
								</h2>
								<p className="mt-1 text-pretty text-sm text-muted-foreground">
									<Trans>
										Each project keeps its own branch and pull request.
									</Trans>
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									className="h-10"
									disabled={linkedWorkspaces.length === 0}
									onClick={() => setBuildDialogOpen(true)}
								>
									<LuHammer />
									<Trans>Generate build</Trans>
								</Button>
								<Button
									variant="outline"
									className="h-10"
									disabled={isReadOnly || !webUrl}
									onClick={() => setLinkDialogOpen(true)}
								>
									<LuLink />
									<Trans>Link existing</Trans>
								</Button>
								<Button
									className="h-10"
									disabled={!claimResolved || isReadOnly}
									onClick={() => setWorktreeDialogOpen(true)}
								>
									<LuPlus />
									<Trans>Add worktree</Trans>
								</Button>
							</div>
						</div>
						<div className="mt-4 grid gap-3">
							{linkedWorkspaces.map((workspace) => {
								return (
									<AzureWorktreeRow
										key={workspace.id}
										workspace={workspace}
										projectName={projectName(workspace.projectId)}
										canUnlink={!isReadOnly}
										workItemId={workItemId}
										workItemType={type}
										workItemTitle={title}
										workItemUrl={webUrl}
										showCreatePullRequest={
											claimResolved && stage === "review" && !isReadOnly
										}
										onPullRequestCreated={() => workItemQuery.refetch()}
									/>
								);
							})}
							{linkedWorkspaces.length === 0 ? (
								<div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
									<Trans>No worktrees yet.</Trans>
								</div>
							) : null}
						</div>
					</section>

					<section className="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-6">
						{claimQuery.error ? (
							<p className="w-full text-sm text-destructive">
								{errorMessage(claimQuery.error)}
							</p>
						) : null}
						{!claimResolved && !claimQuery.error ? (
							<Skeleton className="h-10 w-44" />
						) : null}
						{isReadOnly ? (
							<p className="text-sm text-muted-foreground">
								<Trans>Claimed in Azure DevOps</Trans>
							</p>
						) : null}
						{claimResolved && !isReadOnly && stage === "backlog" ? (
							<Button disabled={claim.isPending} onClick={() => claim.mutate()}>
								<Trans>Start implementation</Trans>
							</Button>
						) : null}
						{claimResolved && !isReadOnly && stage === "implementation" ? (
							<Button onClick={() => setStage.mutate("homologation")}>
								<Trans>Move to homologation</Trans>
							</Button>
						) : null}
						{claimResolved && !isReadOnly && stage === "homologation" ? (
							<>
								<Button
									variant="outline"
									onClick={() => setStage.mutate("implementation")}
								>
									<Trans>Back to implementation</Trans>
								</Button>
								<Button onClick={() => setStage.mutate("review")}>
									<Trans>Move to review</Trans>
								</Button>
							</>
						) : null}
						{claimResolved && !isReadOnly && stage === "review" ? (
							<Button
								variant="outline"
								onClick={() => setStage.mutate("homologation")}
							>
								<Trans>Back to homologation</Trans>
							</Button>
						) : null}
					</section>
				</div>
			</ScrollArea>
			<CreateAzureWorktreeDialog
				open={worktreeDialogOpen}
				onOpenChange={setWorktreeDialogOpen}
				workItemId={workItemId}
				workItemTitle={title}
				workItemUrl={webUrl}
			/>
			<LinkExistingWorktreeDialog
				open={linkDialogOpen}
				onOpenChange={setLinkDialogOpen}
				workItemId={workItemId}
				workItemUrl={webUrl}
				workspaces={workspaces}
				projectName={projectName}
			/>
			<GenerateAzureBuildDialog
				open={buildDialogOpen}
				onOpenChange={setBuildDialogOpen}
				workItemId={workItemId}
				workspaces={linkedWorkspaces}
			/>
		</div>
	);
}
