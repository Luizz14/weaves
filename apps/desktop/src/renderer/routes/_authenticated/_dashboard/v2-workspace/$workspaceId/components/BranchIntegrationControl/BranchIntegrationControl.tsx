import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { toast } from "@superset/ui/sonner";
import { useWorkspaceHostUrl, workspaceTrpc } from "@superset/workspace-client";
import { ArrowDownToLine, GitMerge, Loader2 } from "lucide-react";
import { useState } from "react";
import { BranchIntegrationSettings } from "renderer/components/BranchIntegrationSettings";
import { useIntegrationError } from "renderer/components/BranchIntegrationSettings/hooks/useIntegrationError";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useWorkspaceGitStatus } from "../../providers/WorkspaceGitStatusProvider";
import { ConflictEditor } from "./components/ConflictEditor";

export function BranchIntegrationControl({
	workspaceId,
	mode = "toolbar",
}: {
	workspaceId: string;
	mode?: "toolbar" | "dock";
}) {
	const { t } = useLingui();
	const { workspace } = useWorkspace();
	const hostUrl = useWorkspaceHostUrl();
	const gitStatus = useWorkspaceGitStatus();
	const utils = workspaceTrpc.useUtils();
	const errorText = useIntegrationError();
	const [open, setOpen] = useState(false);
	const [configurationOpen, setConfigurationOpen] = useState(false);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const query = workspaceTrpc.branchIntegration.status.useQuery(
		{ workspaceId },
		{ enabled: !!workspace.projectId, refetchInterval: 5000 },
	);
	const refresh = async () => {
		await Promise.all([query.refetch(), utils.git.invalidate()]);
	};
	const onError = (error: { message: string }) => {
		toast.error(errorText(error));
		void refresh();
		setOpen(true);
	};
	const start = workspaceTrpc.branchIntegration.start.useMutation({
		onSuccess: (session) => {
			if (session.state === "completed")
				toast.success(t({ message: "Branch integration completed" }));
			else setOpen(true);
		},
		onError,
		onSettled: refresh,
	});
	const finish = workspaceTrpc.branchIntegration.finish.useMutation({
		onSuccess: () => {
			toast.success(t({ message: "Branch integration completed" }));
			setOpen(false);
		},
		onError,
		onSettled: refresh,
	});
	const cancel = workspaceTrpc.branchIntegration.cancel.useMutation({
		onSuccess: () => setOpen(false),
		onError,
		onSettled: refresh,
	});
	const data = query.data;
	if (!workspace.projectId || !data) return null;
	const session = data.session;
	const active =
		!!session &&
		(!["completed", "cancelled"].includes(session.state) ||
			session.cleanupPending);
	const busy = start.isPending || finish.isPending || cancel.isPending;
	const branch = data.mergeTargetBranch ?? "";
	const remote = data.updateRemote ?? "";
	const mergeLabel = branch
		? t({ message: `Merge into ${branch}` })
		: t({ message: "Merge into principal" });
	const updateLabel =
		branch && remote
			? t({ message: `Update from ${remote}/${branch}` })
			: t({ message: "Update from remote principal" });
	const path = data.pendingPaths.includes(selectedPath ?? "")
		? selectedPath
		: data.pendingPaths[0];
	const dockMode = mode === "dock";
	const actionButtonClass = dockMode
		? "h-10 w-full justify-start gap-3 rounded-xl border-0 bg-transparent px-3 text-sm font-medium text-foreground shadow-none hover:bg-muted focus-visible:bg-muted"
		: "h-7 gap-1 px-2 text-xs";
	const dirty = !!(
		gitStatus.data?.staged.length || gitStatus.data?.unstaged.length
	);
	const currentBranch = gitStatus.data?.currentBranch.name;
	const blockedReason = dirty
		? errorText({ message: "DIRTY" })
		: currentBranch === branch && branch
			? errorText({ message: "SAME_BRANCH" })
			: currentBranch === "HEAD"
				? errorText({ message: "DETACHED" })
				: data.busyElsewhere
					? errorText({ message: "SESSION_EXISTS" })
					: null;
	const begin = (kind: "merge" | "update") => {
		if (!branch || (kind === "update" && !remote)) {
			setConfigurationOpen(true);
			return;
		}
		start.mutate({ workspaceId, kind });
	};
	return (
		<>
			<div
				className={
					dockMode ? "flex shrink-0 flex-col gap-0.5" : "flex h-7 shrink-0 items-center gap-1"
				}
			>
				{active ? (
					<Button
						size="sm"
						variant={dockMode ? "ghost" : "outline"}
						className={actionButtonClass}
						onClick={() => setOpen(true)}
					>
						<Trans>Resume integration</Trans>
					</Button>
				) : (
					<>
						{data.mergeToMainEnabled && (
							<Button
								size="sm"
								variant={dockMode ? "ghost" : "outline"}
								className={actionButtonClass}
								disabled={busy || !!blockedReason}
								title={blockedReason ?? mergeLabel}
								onClick={() => begin("merge")}
							>
								{start.isPending ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<GitMerge className="size-3.5" />
								)}
								<span className="max-w-40 truncate">{mergeLabel}</span>
							</Button>
						)}
						{data.updateFromMainEnabled && (
							<Button
								size="sm"
								variant={dockMode ? "ghost" : "outline"}
								className={actionButtonClass}
								disabled={busy || !!blockedReason}
								title={blockedReason ?? updateLabel}
								onClick={() => begin("update")}
							>
								{start.isPending ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<ArrowDownToLine className="size-3.5" />
								)}
								<span className="max-w-48 truncate">{updateLabel}</span>
							</Button>
						)}
					</>
				)}
			</div>
			<Dialog open={configurationOpen} onOpenChange={setConfigurationOpen}>
				<DialogContent data-workspace-action-dock-portal={dockMode ? "true" : undefined}>
					<DialogHeader>
						<DialogTitle>
							<Trans>Branch integration</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								Configure the principal branch and remote in project settings.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					<BranchIntegrationSettings
						key={`${hostUrl}:${workspace.projectId}`}
						hostUrl={hostUrl}
						projectId={workspace.projectId}
						onChanged={() => {
							setConfigurationOpen(false);
							void refresh();
						}}
					/>
				</DialogContent>
			</Dialog>
			<Dialog open={open && active} onOpenChange={setOpen}>
				<DialogContent
					className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"
					data-workspace-action-dock-portal={dockMode ? "true" : undefined}
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Branch integration</Trans>
						</DialogTitle>
						<DialogDescription>
							{session?.sourceLabel} → {session?.destinationLabel}
						</DialogDescription>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">
						<Trans>
							The destination stays unchanged until completion. Closing this
							window keeps the attempt available to resume.
						</Trans>
					</p>
					{session && path ? (
						<div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
							<nav
								className="space-y-1"
								aria-label={t({ message: "Conflicting files" })}
							>
								{data.pendingPaths.map((file) => (
									<button
										type="button"
										key={file}
										className={`block w-full break-all rounded p-2 text-left font-mono text-xs hover:bg-accent ${file === path ? "bg-accent" : ""}`}
										onClick={() => setSelectedPath(file)}
									>
										{file}
									</button>
								))}
							</nav>
							<ConflictEditor
								key={`${session.id}:${path}`}
								workspaceId={workspaceId}
								sessionId={session.id}
								path={path}
								source={session.sourceLabel}
								destination={session.destinationLabel}
								onResolved={() => {
									void refresh();
								}}
							/>
						</div>
					) : (
						<p className="text-sm">
							{session?.state === "preparing"
								? t({
										message:
											"Preparation was interrupted. Cancel this attempt and start again.",
									})
								: t({
										message:
											"All conflicts are resolved. Complete the integration when ready.",
									})}
						</p>
					)}
					{session && (
						<div className="flex justify-end gap-2 border-t pt-4">
							<Button
								variant="outline"
								disabled={busy}
								onClick={() =>
									cancel.mutate({ workspaceId, sessionId: session.id })
								}
							>
								<Trans>Cancel integration</Trans>
							</Button>
							<Button
								disabled={
									busy ||
									session.state === "preparing" ||
									data.pendingPaths.length > 0
								}
								onClick={() =>
									finish.mutate({ workspaceId, sessionId: session.id })
								}
							>
								<Trans>Complete integration</Trans>
							</Button>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
