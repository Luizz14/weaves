import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { ScrollArea } from "@superset/ui/scroll-area";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	LuArrowLeft,
	LuExternalLink,
	LuFileText,
	LuLink,
	LuPlus,
} from "react-icons/lu";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { Route as TasksLayoutRoute } from "../../layout";
import { AzureWorktreeRow } from "./components/AzureWorktreeRow";
import { CreateAzureWorktreeDialog } from "./components/CreateAzureWorktreeDialog";

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
	const workItemQuery = useQuery({
		queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
		enabled: hostUrl !== null && Number.isInteger(workItemId),
		queryFn: () =>
			hostUrl
				? getHostServiceClientByUrl(hostUrl).azureDevOps.getWorkItem.query({
						workItemId,
					})
				: null,
		refetchInterval: 30_000,
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
	const claim = useMutation({
		mutationFn: async () => {
			if (!hostUrl) throw new Error("Azure DevOps host is unavailable");
			const iterationPath = stringField(
				workItemQuery.data?.item.fields ?? {},
				"System.IterationPath",
			);
			if (!iterationPath) throw new Error("Work item has no iteration");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.claimWorkItem.mutate({
				workItemId,
				iterationPath,
			});
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
			}),
		onError: (error) => toast.error(errorMessage(error)),
	});
	const setStage = useMutation({
		mutationFn: async (stage: "implementation" | "homologation" | "review") => {
			if (!hostUrl) throw new Error("Azure DevOps host is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.setWorkItemStage.mutate({ workItemId, stage });
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ["azure-devops", "work-item", hostUrl, workItemId],
			}),
		onError: (error) => toast.error(errorMessage(error)),
	});

	if (!Number.isInteger(workItemId)) {
		return (
			<div className="p-6 text-sm text-destructive">
				<Trans>Invalid work item</Trans>
			</div>
		);
	}
	if (workItemQuery.isPending) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				<Trans>Loading work item…</Trans>
			</div>
		);
	}
	if (!workItemQuery.data || workItemQuery.error) {
		return (
			<div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
				{workItemQuery.error
					? errorMessage(workItemQuery.error)
					: t({ message: "Work item not found" })}
			</div>
		);
	}

	const { item, stage, webUrl, claim: workItemClaim } = workItemQuery.data;
	const isReadOnly = Boolean(workItemClaim && !workItemClaim.isCurrentUser);
	const fields = item.fields;
	const title = stringField(fields, "System.Title") ?? `AB#${workItemId}`;
	const type =
		stringField(fields, "System.WorkItemType") ?? t({ message: "Work item" });
	const azureState = stringField(fields, "System.State") ?? "Unknown";
	const iteration = stringField(fields, "System.IterationPath");
	const assignedTo = identityName(fields, "System.AssignedTo");
	const createdBy = identityName(fields, "System.CreatedBy");
	const tags = (stringField(fields, "System.Tags") ?? "")
		.split(";")
		.map((tag) => tag.trim())
		.filter(Boolean);
	const description =
		stringField(fields, "System.Description") ??
		stringField(fields, "Microsoft.VSTS.TCM.ReproSteps") ??
		"";
	const relations = item.relations ?? [];
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
	}[stage];

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
				<span className="text-xs text-muted-foreground">{stageLabel}</span>
				<div className="flex-1" />
				<Button variant="ghost" size="sm" asChild>
					<a href={webUrl} target="_blank" rel="noreferrer">
						<LuExternalLink />
						<Trans>Open in Azure</Trans>
					</a>
				</Button>
			</header>
			<ScrollArea className="min-h-0 flex-1">
				<div className="mx-auto w-full max-w-5xl px-6 py-7">
					<div className="flex flex-wrap gap-2">
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
					<h1 className="mt-4 max-w-4xl text-balance font-serif text-3xl leading-tight">
						{title}
					</h1>
					<section className="mt-8 grid gap-x-10 gap-y-3 sm:grid-cols-2">
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Sprint</Trans>
							</span>
							<span>{iteration ?? "—"}</span>
						</div>
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Stage</Trans>
							</span>
							<span>{stageLabel}</span>
						</div>
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Assigned to</Trans>
							</span>
							<span>{assignedTo ?? "—"}</span>
						</div>
						<div className="grid grid-cols-[8rem_1fr] text-sm">
							<span className="text-muted-foreground">
								<Trans>Created by</Trans>
							</span>
							<span>{createdBy ?? "—"}</span>
						</div>
					</section>

					<section className="mt-10">
						<h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
							<Trans>Description</Trans>
						</h2>
						<div className="mt-3 min-h-16 text-sm">
							{description ? (
								<MarkdownRenderer content={description} allowHtml />
							) : (
								<p className="text-muted-foreground">
									<Trans>No description provided.</Trans>
								</p>
							)}
						</div>
					</section>

					{relatedWork.length > 0 || attachments.length > 0 ? (
						<section className="mt-10">
							<h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
								<Trans>Related work</Trans>
							</h2>
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
							<Button
								className="h-10"
								disabled={isReadOnly}
								onClick={() => setWorktreeDialogOpen(true)}
							>
								<LuPlus />
								<Trans>Add worktree</Trans>
							</Button>
						</div>
						<div className="mt-4 grid gap-3">
							{linkedWorkspaces.map((workspace) => {
								const projectName = workspace.projectId
									? (projectNameById.get(workspace.projectId) ??
										workspace.projectId)
									: t({ message: "Unknown project" });
								return (
									<AzureWorktreeRow
										key={workspace.id}
										workspace={workspace}
										projectName={projectName}
										workItemId={workItemId}
										workItemType={type}
										workItemTitle={title}
										workItemUrl={webUrl}
										showCreatePullRequest={stage === "review" && !isReadOnly}
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
						{isReadOnly ? (
							<p className="text-sm text-muted-foreground">
								<Trans>Claimed in Azure DevOps</Trans>
							</p>
						) : null}
						{!isReadOnly && stage === "backlog" ? (
							<Button disabled={claim.isPending} onClick={() => claim.mutate()}>
								<Trans>Start implementation</Trans>
							</Button>
						) : null}
						{!isReadOnly && stage === "implementation" ? (
							<Button onClick={() => setStage.mutate("homologation")}>
								<Trans>Move to homologation</Trans>
							</Button>
						) : null}
						{!isReadOnly && stage === "homologation" ? (
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
						{!isReadOnly && stage === "review" ? (
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
		</div>
	);
}
