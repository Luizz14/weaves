import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Checkbox } from "@superset/ui/checkbox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { workspaceTrpc } from "@superset/workspace-client";
import {
	ChevronDown,
	ExternalLink,
	FileText,
	GitCompare,
	Minus,
	Plus,
	SquarePlus,
	Trash2,
	Undo2,
} from "lucide-react";
import { memo, useState } from "react";
import {
	modifierLabel,
	useChangesSidebarFilePolicy,
} from "renderer/lib/clickPolicy";
import { ZedFileIcon } from "renderer/lib/zedProjectPanel/components/ZedFileIcon";
import { DiscardConfirmDialog } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/DiscardConfirmDialog";
import { StatusIndicator } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/StatusIndicator";
import {
	type ChangesetFile,
	getChangesetFileKey,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import type { LocalChangeEntry } from "../../../LocalChangesList/localChanges";
import { useFileDrag } from "../../hooks/useFileDrag";
import { useStagingMutations } from "../../hooks/useStagingMutations";
import { DiffStatText } from "../DiffStatText";
import { PathActionsMenuItems } from "../PathActionsMenuItems";
import { StageToggleButton } from "../StageToggleButton";

function splitPath(path: string): { dir: string; basename: string } {
	path = path.replace(/\/$/, "");
	const lastSlash = path.lastIndexOf("/");
	if (lastSlash < 0) return { dir: "", basename: path };
	return {
		dir: `${path.slice(0, lastSlash)}/`,
		basename: path.slice(lastSlash + 1),
	};
}

interface FileRowProps {
	file: ChangesetFile;
	staging?: LocalChangeEntry;
	disabled?: boolean;
	onToggleStage?: (staged: boolean) => void;
	workspaceId: string;
	worktreePath?: string;
	/** Hide the directory prefix — used when the row sits under a folder group. */
	hideDir?: boolean;
	/** Highlight as the diff pane's currently open file. */
	isSelected?: boolean;
	onSelect?: (path: string, openInNewTab?: boolean, changeKey?: string) => void;
	onOpenFile?: (absolutePath: string, openInNewTab?: boolean) => void;
	onOpenInEditor?: (path: string) => void;
}

export const FileRow = memo(function FileRow({
	file,
	staging,
	disabled = false,
	onToggleStage,
	workspaceId,
	worktreePath,
	hideDir,
	isSelected,
	onSelect,
	onOpenFile,
	onOpenInEditor,
}: FileRowProps) {
	const { t } = useLingui();
	const { dir: fullDir, basename } = splitPath(file.path);
	const dir = hideDir ? "" : fullDir;
	const oldBasename =
		file.oldPath && (file.status === "renamed" || file.status === "copied")
			? splitPath(file.oldPath).basename
			: null;
	const absolutePath = worktreePath
		? toAbsoluteWorkspacePath(worktreePath, file.path)
		: undefined;
	const changeKey = getChangesetFileKey(file);
	const canStage = staging
		? !!staging.unstaged
		: file.source.kind === "unstaged";
	const canUnstage = staging ? !!staging.staged : file.source.kind === "staged";
	const canDiscard = canStage;
	const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
	const discardSource = staging?.unstaged ?? file;
	const isDeleteAction =
		discardSource.status === "untracked" ||
		(discardSource.status === "added" && !staging?.staged);
	const utils = workspaceTrpc.useUtils();
	const discardMutation = workspaceTrpc.git.discardChanges.useMutation({
		onSuccess: () => {
			void utils.git.getStatus.invalidate({ workspaceId });
			void utils.git.getDiff.invalidate({ workspaceId });
		},
		onError: (err) => {
			toast.error(
				t({
					message: "Couldn't discard changes",
				}),
				{
					description: errorMessage(err),
				},
			);
		},
	});
	const confirmDiscard = () => {
		if (disabled || discardMutation.isPending) return;
		setShowDiscardConfirm(false);
		discardMutation.mutate({ workspaceId, filePath: file.path });
	};
	const mutations = useStagingMutations(workspaceId);
	const stageFile = (value: ChangesetFile) => {
		if (disabled || discardMutation.isPending) return;
		if (staging && onToggleStage) onToggleStage(true);
		else void mutations.stageFile(value);
	};
	const unstageFile = (value: ChangesetFile) => {
		if (disabled || discardMutation.isPending) return;
		if (staging && onToggleStage) onToggleStage(false);
		else void mutations.unstageFile(value);
	};
	const statusColor =
		file.status === "added" || file.status === "untracked"
			? "text-green-700 dark:text-green-400"
			: file.status === "deleted"
				? "text-muted-foreground line-through"
				: file.status === "modified" || file.status === "changed"
					? "text-orange-700 dark:text-orange-400"
					: file.status === "renamed" || file.status === "copied"
						? "text-blue-700 dark:text-blue-400"
						: "text-foreground";
	const stagedSource = staging?.staged;
	const unstagedSource = staging?.unstaged;
	const diffSide =
		file.source.kind === "staged"
			? t({ message: "Staged diff" })
			: t({ message: "Unstaged diff" });

	const policy = useChangesSidebarFilePolicy();
	const diffNewTabTier = policy.tierForIntent("diffNewTab");
	const fileTier = policy.tierForIntent("file");
	const externalTier = policy.tierForIntent("external");
	const fileDrag = useFileDrag({ absolutePath });

	const rowButton = (
		<div
			className="group relative text-[15px]"
			style={{ fontFamily: '"Project Plex Sans", "IBM Plex Sans", sans-serif' }}
		>
			<button
				type="button"
				data-change-navigation
				data-change-path={file.path}
				aria-label={file.path}
				aria-current={isSelected ? "true" : undefined}
				className={cn(
					"flex h-6 w-full items-center gap-2 pl-2 text-left hover:bg-accent/50 focus-visible:bg-accent/50",
					staging ? "pr-8" : "pr-3",
					isSelected && "bg-accent/70",
				)}
				{...fileDrag}
				onClick={(e) => {
					const intent = policy.getIntent(e);
					if (intent === "external") onOpenInEditor?.(file.path);
					else if (intent === "file" && absolutePath)
						onOpenFile?.(absolutePath, false);
					else if (intent === "diffNewTab")
						onSelect?.(file.path, true, changeKey);
					else if (intent === "diff") onSelect?.(file.path, false, changeKey);
				}}
			>
				<ZedFileIcon fileName={basename} />
				<span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
					{oldBasename && (
						<span className="truncate text-muted-foreground">
							{oldBasename} →
						</span>
					)}
					<span className={cn("min-w-0 truncate", statusColor)}>
						{basename}
					</span>
					{dir && (
						<span className="min-w-0 truncate text-xs text-muted-foreground">
							{dir.replace(/\/$/, "")}
						</span>
					)}
				</span>
				<span
					className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums group-hover:invisible group-focus-within:invisible group-has-[[data-state=open]]:invisible"
					title={staging ? diffSide : undefined}
				>
					<DiffStatText additions={file.additions} deletions={file.deletions} />
					{!staging && <StatusIndicator status={file.status} />}
				</span>
			</button>
			{staging && (
				<div className="absolute inset-y-0 right-2 flex items-center">
					<Tooltip>
						<TooltipTrigger asChild>
							<Checkbox
								aria-label={
									staging.state === "staged"
										? t({ message: "Unstage file" })
										: t({ message: "Stage file" })
								}
								checked={
									staging.state === "partial"
										? "indeterminate"
										: staging.state === "staged"
								}
								disabled={disabled || discardMutation.isPending}
								className="git-stage-checkbox relative size-3.5 border-muted-foreground/60"
								onCheckedChange={() =>
									staging.state === "staged"
										? unstageFile(staging.staged ?? file)
										: stageFile(staging.unstaged ?? file)
								}
							/>
						</TooltipTrigger>
						<TooltipContent>
							{staging.state === "partial"
								? t({
										message: "Partially staged; stage all changes in this file",
									})
								: staging.state === "staged"
									? t({ message: "Unstage file" })
									: t({ message: "Stage file" })}
						</TooltipContent>
					</Tooltip>
				</div>
			)}
			<div
				className={cn(
					"pointer-events-none absolute inset-y-0 flex items-center gap-0.5 bg-background opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
					staging ? "right-7" : "right-2",
				)}
			>
				{canDiscard && (
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								disabled={disabled || discardMutation.isPending}
								aria-label={t({
									message: "Discard changes",
								})}
								className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
								onClick={(e) => {
									e.stopPropagation();
									setShowDiscardConfirm(true);
								}}
							>
								<Undo2 className="size-3.5" />
							</button>
						</TooltipTrigger>
						<TooltipContent side="top">
							<Trans>Discard changes</Trans>
						</TooltipContent>
					</Tooltip>
				)}
				{!staging && canStage && (
					<StageToggleButton action="stage" onClick={() => stageFile(file)} />
				)}
				{!staging && canUnstage && (
					<StageToggleButton
						action="unstage"
						onClick={() => unstageFile(file)}
					/>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={t({
								message: "More actions",
							})}
							className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
							onClick={(e) => e.stopPropagation()}
						>
							<ChevronDown className="size-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-64">
						<DropdownMenuItem
							onSelect={() => onSelect?.(file.path, false, changeKey)}
						>
							<GitCompare />
							<Trans>Open Diff</Trans>
						</DropdownMenuItem>
						{stagedSource && unstagedSource && (
							<DropdownMenuItem
								onSelect={() =>
									onSelect?.(
										stagedSource.path,
										false,
										getChangesetFileKey(stagedSource),
									)
								}
							>
								<GitCompare />
								<Trans>View staged diff</Trans>
							</DropdownMenuItem>
						)}
						{stagedSource &&
							unstagedSource &&
							file.source.kind === "staged" && (
								<DropdownMenuItem
									onSelect={() =>
										onSelect?.(
											unstagedSource.path,
											false,
											getChangesetFileKey(unstagedSource),
										)
									}
								>
									<GitCompare />
									<Trans>View unstaged diff</Trans>
								</DropdownMenuItem>
							)}
						<DropdownMenuItem
							onSelect={() => onSelect?.(file.path, true, changeKey)}
						>
							<SquarePlus />
							<Trans>Open Diff in New Tab</Trans>
							{diffNewTabTier && (
								<DropdownMenuShortcut>
									{modifierLabel(diffNewTabTier)}
								</DropdownMenuShortcut>
							)}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => absolutePath && onOpenFile?.(absolutePath)}
							disabled={!onOpenFile || !absolutePath}
						>
							<FileText />
							<Trans>Open File</Trans>
							{fileTier && (
								<DropdownMenuShortcut>
									{modifierLabel(fileTier)}
								</DropdownMenuShortcut>
							)}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => absolutePath && onOpenFile?.(absolutePath, true)}
							disabled={!onOpenFile || !absolutePath}
						>
							<SquarePlus />
							<Trans>Open File in New Tab</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => onOpenInEditor?.(file.path)}
							disabled={!onOpenInEditor}
						>
							<ExternalLink />
							<Trans>Open in Editor</Trans>
							{externalTier && (
								<DropdownMenuShortcut>
									{modifierLabel(externalTier)}
								</DropdownMenuShortcut>
							)}
						</DropdownMenuItem>
						{canStage && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									disabled={disabled || discardMutation.isPending}
									onSelect={() => stageFile(file)}
								>
									<Plus />
									<Trans>Stage file</Trans>
								</DropdownMenuItem>
							</>
						)}
						{canUnstage && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									disabled={disabled || discardMutation.isPending}
									onSelect={() => unstageFile(file)}
								>
									<Minus />
									<Trans>Unstage file</Trans>
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);

	return (
		<ContextMenu>
			<Tooltip delayDuration={500}>
				<ContextMenuTrigger asChild>
					<TooltipTrigger asChild>{rowButton}</TooltipTrigger>
				</ContextMenuTrigger>
				<TooltipContent side="right">{policy.hint}</TooltipContent>
			</Tooltip>
			<ContextMenuContent className="w-64">
				<ContextMenuItem
					onSelect={() => onSelect?.(file.path, false, changeKey)}
				>
					<GitCompare />
					<Trans>Open Diff</Trans>
				</ContextMenuItem>
				{stagedSource && unstagedSource && (
					<ContextMenuItem
						onSelect={() =>
							onSelect?.(
								stagedSource.path,
								false,
								getChangesetFileKey(stagedSource),
							)
						}
					>
						<GitCompare />
						<Trans>View staged diff</Trans>
					</ContextMenuItem>
				)}
				{stagedSource && unstagedSource && file.source.kind === "staged" && (
					<ContextMenuItem
						onSelect={() =>
							onSelect?.(
								unstagedSource.path,
								false,
								getChangesetFileKey(unstagedSource),
							)
						}
					>
						<GitCompare />
						<Trans>View unstaged diff</Trans>
					</ContextMenuItem>
				)}
				<ContextMenuItem
					onSelect={() => onSelect?.(file.path, true, changeKey)}
				>
					<SquarePlus />
					<Trans>Open Diff in New Tab</Trans>
					{diffNewTabTier && (
						<ContextMenuShortcut>
							{modifierLabel(diffNewTabTier)}
						</ContextMenuShortcut>
					)}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => absolutePath && onOpenFile?.(absolutePath)}
					disabled={!onOpenFile || !absolutePath}
				>
					<FileText />
					<Trans>Open File</Trans>
					{fileTier && (
						<ContextMenuShortcut>{modifierLabel(fileTier)}</ContextMenuShortcut>
					)}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => absolutePath && onOpenFile?.(absolutePath, true)}
					disabled={!onOpenFile || !absolutePath}
				>
					<SquarePlus />
					<Trans>Open File in New Tab</Trans>
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => onOpenInEditor?.(file.path)}
					disabled={!onOpenInEditor}
				>
					<ExternalLink />
					<Trans>Open in Editor</Trans>
					{externalTier && (
						<ContextMenuShortcut>
							{modifierLabel(externalTier)}
						</ContextMenuShortcut>
					)}
				</ContextMenuItem>
				{absolutePath && (
					<>
						<ContextMenuSeparator />
						<PathActionsMenuItems
							absolutePath={absolutePath}
							relativePath={file.path}
						/>
					</>
				)}
				{(canStage || canUnstage) && <ContextMenuSeparator />}
				{canStage && (
					<ContextMenuItem
						disabled={disabled || discardMutation.isPending}
						onSelect={() => stageFile(file)}
					>
						<Plus />
						<Trans>Stage file</Trans>
					</ContextMenuItem>
				)}
				{canUnstage && (
					<ContextMenuItem
						disabled={disabled || discardMutation.isPending}
						onSelect={() => unstageFile(file)}
					>
						<Minus />
						<Trans>Unstage file</Trans>
					</ContextMenuItem>
				)}
				{canDiscard && (
					<ContextMenuItem
						variant="destructive"
						disabled={disabled || discardMutation.isPending}
						onSelect={() => setShowDiscardConfirm(true)}
					>
						{isDeleteAction ? <Trash2 /> : <Undo2 />}
						{isDeleteAction
							? t({ message: "Delete" })
							: t({
									message: "Discard changes",
								})}
					</ContextMenuItem>
				)}
			</ContextMenuContent>
			<DiscardConfirmDialog
				open={showDiscardConfirm}
				onOpenChange={setShowDiscardConfirm}
				title={
					isDeleteAction
						? t({
								message: `Delete "${basename}"?`,
							})
						: t({
								message: `Discard changes to "${basename}"?`,
							})
				}
				description={
					isDeleteAction
						? t({
								message:
									"This will permanently delete this file. This action cannot be undone.",
							})
						: t({
								message:
									"This will discard unstaged changes to this file. Staged changes will be preserved.",
							})
				}
				confirmLabel={
					isDeleteAction
						? t({
								message: "Delete",
							})
						: t({
								message: "Discard",
							})
				}
				onConfirm={confirmDiscard}
			/>
		</ContextMenu>
	);
});
