import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Checkbox } from "@superset/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { cn } from "@superset/ui/utils";
import { useMemo, useState } from "react";
import { LuGitBranch } from "react-icons/lu";
import { useOptimisticActions } from "renderer/routes/_authenticated/hooks/useOptimisticActions";
import type { HostWorkspaceItem } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { groupLinkableWorkspaces } from "./utils/groupLinkableWorkspaces";

type LinkExistingWorktreeDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workItemId: number;
	workItemUrl: string;
	workspaces: HostWorkspaceItem[];
	projectName: (projectId: string | null) => string;
};

export function LinkExistingWorktreeDialog({
	open,
	onOpenChange,
	workItemId,
	workItemUrl,
	workspaces,
	projectName,
}: LinkExistingWorktreeDialogProps) {
	const { t } = useLingui();
	const actions = useOptimisticActions();
	const [query, setQuery] = useState("");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const groups = useMemo(
		() =>
			groupLinkableWorkspaces(
				workspaces,
				String(workItemId),
				query,
				projectName,
			),
		[projectName, query, workItemId, workspaces],
	);
	const movedCount = workspaces.filter(
		(workspace) =>
			selectedIds.has(workspace.id) &&
			workspace.externalWorkItemProvider === "azure-devops" &&
			workspace.externalWorkItemId != null,
	).length;
	const selectedCount = selectedIds.size;

	const close = (nextOpen: boolean) => {
		if (!nextOpen) {
			setQuery("");
			setSelectedIds(new Set());
		}
		onOpenChange(nextOpen);
	};

	const toggle = (workspaceId: string) =>
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(workspaceId)) next.delete(workspaceId);
			else next.add(workspaceId);
			return next;
		});

	const link = () => {
		for (const workspaceId of selectedIds) {
			actions.v2Workspaces.updateWorkspace(workspaceId, {
				externalWorkItem: {
					provider: "azure-devops",
					id: String(workItemId),
					url: workItemUrl,
				},
			});
		}
		close(false);
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-balance">
						<Trans>Link existing worktrees</Trans>
					</DialogTitle>
					<DialogDescription className="text-pretty">
						<Trans>
							Attach worktrees you already have to #{workItemId}. They keep
							their branch and stay in their project.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<Input
					autoFocus
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t({ message: "Search by name, branch or project" })}
					className="h-10"
				/>
				<div className="-mx-2 max-h-80 overflow-y-auto px-2">
					{groups.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							<Trans>No worktrees to link.</Trans>
						</p>
					) : (
						groups.map((group) => (
							<div key={group.projectId ?? "none"} className="py-1.5">
								<p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
									{group.projectName}
								</p>
								{group.workspaces.map((workspace) => {
									const selected = selectedIds.has(workspace.id);
									const linkedElsewhere =
										workspace.externalWorkItemProvider === "azure-devops"
											? workspace.externalWorkItemId
											: null;
									return (
										<label
											key={workspace.id}
											htmlFor={`link-worktree-${workspace.id}`}
											className={cn(
												"flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors",
												selected ? "bg-muted" : "hover:bg-muted/60",
											)}
										>
											<Checkbox
												id={`link-worktree-${workspace.id}`}
												checked={selected}
												onCheckedChange={() => toggle(workspace.id)}
											/>
											<LuGitBranch className="size-4 shrink-0 text-muted-foreground" />
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm">
													{workspace.name}
												</span>
												<span className="block truncate font-mono text-xs text-muted-foreground">
													{workspace.branch}
												</span>
											</span>
											{linkedElsewhere ? (
												<span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
													#{linkedElsewhere}
												</span>
											) : null}
										</label>
									);
								})}
							</div>
						))
					)}
				</div>
				{movedCount > 0 ? (
					<p className="text-pretty text-xs text-muted-foreground">
						<Trans>
							{movedCount} selected worktree(s) will move here from another work
							item.
						</Trans>
					</p>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={() => close(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button disabled={selectedCount === 0} onClick={link}>
						<Trans>Link {selectedCount}</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
