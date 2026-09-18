import { Trans, useLingui } from "@lingui/react/macro";
import {
	Command,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@superset/ui/dialog";
import { Kbd } from "@superset/ui/kbd";
import { Check, CornerDownLeft, FolderGit2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "renderer/lib/utils";

export type LinkableWorkspace = {
	id: string;
	name: string;
	branch?: string | null;
	projectId: string | null;
	projectName: string;
};

type ProjectGroup = {
	key: string;
	projectName: string;
	workspaces: LinkableWorkspace[];
};

function matches(workspace: LinkableWorkspace, needle: string): boolean {
	if (!needle) return true;
	const haystack = [
		workspace.name,
		workspace.branch ?? "",
		workspace.projectName,
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

function groupByProject(workspaces: LinkableWorkspace[]): ProjectGroup[] {
	const groups: ProjectGroup[] = [];
	const byKey = new Map<string, ProjectGroup>();
	for (const workspace of workspaces) {
		const key = workspace.projectId ?? `name:${workspace.projectName}`;
		let group = byKey.get(key);
		if (!group) {
			group = { key, projectName: workspace.projectName, workspaces: [] };
			byKey.set(key, group);
			groups.push(group);
		}
		group.workspaces.push(workspace);
	}
	return groups;
}

export function LinkWorkspacesDialog({
	open,
	onOpenChange,
	workspaces,
	linkedIds,
	isLoading,
	onToggle,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaces: LinkableWorkspace[];
	linkedIds: string[];
	isLoading?: boolean;
	onToggle: (workspaceId: string) => void;
}) {
	const { t } = useLingui();
	const [query, setQuery] = useState("");
	const [highlighted, setHighlighted] = useState("");

	const linked = useMemo(() => new Set(linkedIds), [linkedIds]);
	const needle = query.trim().toLowerCase();
	const groups = useMemo(
		() => groupByProject(workspaces.filter((w) => matches(w, needle))),
		[workspaces, needle],
	);
	const visibleCount = groups.reduce(
		(total, group) => total + group.workspaces.length,
		0,
	);

	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="gap-0 overflow-hidden rounded-2xl p-1.5 sm:max-w-xl"
				showCloseButton={false}
			>
				<DialogTitle className="sr-only">
					<Trans>Link workspaces</Trans>
				</DialogTitle>
				<DialogDescription className="sr-only">
					<Trans>
						Search workspaces on this host and link them to this chat.
					</Trans>
				</DialogDescription>
				<Command
					className="rounded-[10px] bg-transparent"
					shouldFilter={false}
					value={highlighted}
					onValueChange={setHighlighted}
				>
					<CommandInput
						placeholder={t({ message: "Search workspaces…" })}
						value={query}
						onValueChange={setQuery}
					/>
					<CommandList className="max-h-[336px] p-1">
						{isLoading ? (
							<p className="px-2 py-6 text-center text-muted-foreground text-sm">
								<Trans>Loading workspaces…</Trans>
							</p>
						) : visibleCount === 0 ? (
							<p className="px-2 py-6 text-center text-muted-foreground text-sm">
								<Trans>No workspaces found.</Trans>
							</p>
						) : (
							groups.map((group) => (
								<div className="mb-1 last:mb-0" key={group.key}>
									<div className="truncate px-2 py-1.5 text-muted-foreground text-xs font-medium">
										{group.projectName}
									</div>
									{group.workspaces.map((workspace) => {
										const isLinked = linked.has(workspace.id);
										const isHighlighted = highlighted === workspace.id;
										return (
											<CommandItem
												className="min-h-9 gap-2.5 rounded-md px-2 py-1.5 transition-[background-color,color,scale] duration-150 active:scale-[0.96] motion-reduce:active:scale-100"
												key={workspace.id}
												onSelect={() => onToggle(workspace.id)}
												value={workspace.id}
											>
												<span
													aria-hidden="true"
													className={cn(
														"grid size-4 shrink-0 place-items-center",
														isLinked
															? "text-emerald-600 dark:text-emerald-400"
															: "text-muted-foreground",
													)}
												>
													{isLinked ? (
														<Check className="size-4" />
													) : (
														<FolderGit2 className="size-4" />
													)}
												</span>
												<span className="min-w-0 flex-1 truncate">
													{workspace.name}
												</span>
												{workspace.branch ? (
													<span className="min-w-0 max-w-[40%] shrink truncate text-muted-foreground text-xs">
														{workspace.branch}
													</span>
												) : null}
												{isHighlighted ? (
													<span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
														{isLinked ? (
															<Trans>Unlink</Trans>
														) : (
															<Trans>Link</Trans>
														)}
														<Kbd>
															<CornerDownLeft />
														</Kbd>
													</span>
												) : null}
												<span className="sr-only">
													{isLinked
														? t({ message: "Linked" })
														: t({ message: "Not linked" })}
												</span>
											</CommandItem>
										);
									})}
								</div>
							))
						)}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
