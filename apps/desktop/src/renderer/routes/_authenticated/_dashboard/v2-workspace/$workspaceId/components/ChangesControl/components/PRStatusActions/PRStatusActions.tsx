import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { ArrowUpRight, GitMerge, GitPullRequest, Loader2 } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import type { PRFlowState } from "../../utils/getPRFlowState";

interface PRStatusActionsProps {
	state: PRFlowState;
	workspaceId: string;
	onRefresh: () => void;
	onOpenPullRequest?: (prNumber: number) => void;
}

export function PRStatusActions({
	state,
	workspaceId,
	onRefresh,
	onOpenPullRequest,
}: PRStatusActionsProps) {
	const { t } = useLingui();
	const { workspace } = useWorkspace();
	const [pendingMergeMethod, setPendingMergeMethod] = useState<
		"merge" | "squash" | "rebase" | null
	>(null);
	const projectId = workspace.projectId;
	const pr =
		state.kind === "pr-exists"
			? state.pr
			: state.kind === "busy" || state.kind === "error"
				? state.pr
				: null;
	const refreshPRMutation =
		workspaceTrpc.pullRequests.refreshByWorkspaces.useMutation();
	const mergePRMutation = workspaceTrpc.github.mergePR.useMutation({
		onMutate: () => {
			const toastId = toast.loading(t({ message: "Merging PR..." }));
			return { toastId };
		},
		onSuccess: async (_data, _variables, context) => {
			toast.success(t({ message: "PR merged" }), { id: context?.toastId });
			try {
				await refreshPRMutation.mutateAsync({ workspaceIds: [workspaceId] });
			} catch (error) {
				console.warn("Failed to refresh PR state after merge", error);
				toast.warning(
					t({
						message:
							"Merged, but couldn't refresh PR state — try again in a moment",
					}),
				);
			} finally {
				onRefresh();
			}
		},
		onError: (error, _variables, context) => {
			toast.error(t({ message: `Merge failed: ${error.message}` }), {
				id: context?.toastId,
			});
		},
		onSettled: () => setPendingMergeMethod(null),
	});
	const markReadyMutation =
		workspaceTrpc.github.markPullRequestReady.useMutation({
			onMutate: () => {
				const toastId = toast.loading(t({ message: "Marking ready for review..." }));
				return { toastId };
			},
			onSuccess: async (_data, _variables, context) => {
				toast.success(t({ message: "PR ready for review" }), {
					id: context?.toastId,
				});
				try {
					await refreshPRMutation.mutateAsync({ workspaceIds: [workspaceId] });
				} catch (error) {
					console.warn("Failed to refresh PR state after marking ready", error);
					toast.warning(
						t({
							message:
								"Marked ready, but couldn't refresh PR state — try again in a moment",
						}),
					);
				} finally {
					onRefresh();
				}
			},
			onError: (error, _variables, context) => {
				toast.error(t({ message: `Ready for review failed: ${error.message}` }), {
					id: context?.toastId,
				});
			},
		});

	if (!pr) return null;

	const canMerge = pr.state === "open" && !pr.isDraft;
	const canMarkReady =
		pr.isDraft && pr.state !== "closed" && pr.state !== "merged";
	const isBusy = mergePRMutation.isPending || markReadyMutation.isPending;
	const handleMerge = (mergeMethod: "merge" | "squash" | "rebase") => {
		setPendingMergeMethod(mergeMethod);
		mergePRMutation.mutate({
			owner: pr.repoOwner,
			repo: pr.repoName,
			pullNumber: pr.number,
			mergeMethod,
		});
	};
	const rowClassName =
		"flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-foreground outline-none transition-[background-color,transform] hover:bg-muted focus-visible:bg-muted active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50";

	return (
		<div className="flex flex-col gap-0.5">
			{canMarkReady && (
				<button
					type="button"
					className={rowClassName}
					disabled={isBusy}
					onClick={() =>
						markReadyMutation.mutate({
							owner: pr.repoOwner,
							repo: pr.repoName,
							pullNumber: pr.number,
						})
					}
				>
					{markReadyMutation.isPending ? (
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					) : (
						<GitPullRequest className="size-4 text-muted-foreground" />
					)}
					<Trans>Ready for review</Trans>
				</button>
			)}
			{canMerge && (
				<>
					<div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
						<Trans>Merge</Trans>
					</div>
					{([
						["squash", t({ message: "Squash and merge" })],
						["merge", t({ message: "Create merge commit" })],
						["rebase", t({ message: "Rebase and merge" })],
					] as const).map(([method, label]) => (
						<button
							key={method}
							type="button"
							className={rowClassName}
							disabled={isBusy}
							onClick={() => handleMerge(method)}
						>
							{pendingMergeMethod === method ? (
								<Loader2 className="size-4 animate-spin text-muted-foreground" />
							) : (
								<GitMerge className="size-4 text-muted-foreground" />
							)}
							{label}
						</button>
					))}
				</>
			)}
			{projectId != null && onOpenPullRequest && (
				<button
					type="button"
					className={rowClassName}
					onClick={() => onOpenPullRequest(pr.number)}
				>
					<GitPullRequest className="size-4 text-muted-foreground" />
					<Trans>Open pull request</Trans>
				</button>
			)}
			<a
				href={pr.url}
				target="_blank"
				rel="noopener noreferrer"
				className={rowClassName}
			>
				<ArrowUpRight className="size-4 text-muted-foreground" />
				<Trans>View on GitHub</Trans>
			</a>
		</div>
	);
}
