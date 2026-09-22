import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LuGitBranch, LuGitPullRequest } from "react-icons/lu";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { navigateToV2Workspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import type { HostWorkspaceItem } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { CreateAzurePullRequestDialog } from "../CreateAzurePullRequestDialog";

type AzureWorktreeRowProps = {
	workspace: HostWorkspaceItem;
	projectName: string;
	workItemId: number;
	workItemType: string;
	workItemTitle: string;
	workItemUrl: string;
	showCreatePullRequest: boolean;
	onPullRequestCreated: () => void;
};

export function AzureWorktreeRow({
	workspace,
	projectName,
	workItemId,
	workItemType,
	workItemTitle,
	workItemUrl,
	showCreatePullRequest,
	onPullRequestCreated,
}: AzureWorktreeRowProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const hostUrl = useHostUrl(workspace.hostId);
	const [pullRequestDialogOpen, setPullRequestDialogOpen] = useState(false);
	const pullRequestQueryKey = [
		"azure-devops",
		"workspace-pull-request",
		workspace.hostId,
		workspace.id,
	] as const;
	const pullRequestQuery = useQuery({
		queryKey: pullRequestQueryKey,
		enabled: hostUrl !== null,
		queryFn: () =>
			hostUrl
				? getHostServiceClientByUrl(hostUrl).pullRequests.getByWorkspaces.query(
						{
							workspaceIds: [workspace.id],
						},
					)
				: null,
	});
	const linkedPullRequest =
		pullRequestQuery.data?.workspaces[0]?.pullRequest ?? null;

	return (
		<>
			<div className="flex min-h-16 items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
				<LuGitBranch className="size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<p className="truncate font-mono text-sm">{workspace.branch}</p>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{projectName}
					</p>
				</div>
				{linkedPullRequest && workspace.projectId ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							navigate({
								to: "/pull-requests/$prNumber",
								params: { prNumber: String(linkedPullRequest.number) },
								search: {
									provider: "azure-devops",
									project: workspace.projectId ?? undefined,
								},
							})
						}
					>
						<LuGitPullRequest />
						<Trans>Open pull request</Trans>
					</Button>
				) : showCreatePullRequest ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPullRequestDialogOpen(true)}
					>
						<LuGitPullRequest />
						<Trans>Create PR</Trans>
					</Button>
				) : null}
				<Button
					variant="outline"
					size="sm"
					onClick={() => void navigateToV2Workspace(workspace.id, navigate)}
				>
					<Trans>Open</Trans>
				</Button>
			</div>
			<CreateAzurePullRequestDialog
				open={pullRequestDialogOpen}
				onOpenChange={setPullRequestDialogOpen}
				workspace={{
					id: workspace.id,
					hostId: workspace.hostId,
					branch: workspace.branch,
				}}
				workItemId={workItemId}
				workItemType={workItemType}
				workItemTitle={workItemTitle}
				workItemUrl={workItemUrl}
				projectName={projectName}
				onCreated={() => {
					void queryClient.invalidateQueries({ queryKey: pullRequestQueryKey });
					onPullRequestCreated();
				}}
			/>
		</>
	);
}
