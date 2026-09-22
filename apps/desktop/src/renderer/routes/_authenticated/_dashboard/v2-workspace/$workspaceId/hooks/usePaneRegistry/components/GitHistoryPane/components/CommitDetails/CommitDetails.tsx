import { Trans } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { formatDateTime } from "@superset/i18n/format";
import { cn } from "@superset/ui/utils";
import { workspaceTrpc } from "@superset/workspace-client";
import type { HistoryCommit } from "../../types";

export function CommitDetails({
	workspaceId,
	commit,
	emptyTree,
	selectedPath,
	onSelectFile,
}: {
	workspaceId: string;
	commit: HistoryCommit;
	emptyTree: string;
	selectedPath?: string;
	onSelectFile: (
		path: string,
		oldPath: string | undefined,
		deleted: boolean,
	) => void;
}) {
	const files = workspaceTrpc.git.getCommitFiles.useQuery(
		{
			workspaceId,
			commitHash: commit.hash,
			fromHash: commit.parents[0] ?? emptyTree,
		},
		{ staleTime: Infinity },
	);
	return (
		<aside className="flex h-full w-full min-h-0 min-w-0 flex-col bg-muted/10">
			<div className="space-y-3 border-b p-4">
				<h2 className="break-words font-medium text-sm text-balance">
					{commit.message}
				</h2>
				<p className="break-all font-mono text-[11px] text-muted-foreground select-text">
					{commit.hash}
				</p>
				<div className="text-xs">
					<p>{commit.author}</p>
					<p className="break-all text-muted-foreground">
						{commit.authorEmail}
					</p>
					<time
						className="text-muted-foreground tabular-nums"
						dateTime={commit.date}
					>
						{formatDateTime(new Date(commit.date))}
					</time>
				</div>
				{commit.parents.length > 1 && (
					<p className="text-xs text-muted-foreground">
						<Trans>Compared with first parent</Trans>
					</p>
				)}
				{commit.body !== commit.message && (
					<p className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground text-pretty">
						{commit.body.slice(commit.message.length).trim()}
					</p>
				)}
			</div>
			<h3 className="px-4 py-3 text-xs font-medium">
				<Trans>Files</Trans>
			</h3>
			<div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
				{files.isPending && (
					<output className="p-2 text-xs text-muted-foreground">
						<Trans>Loading</Trans>
					</output>
				)}
				{files.error && (
					<div role="alert" className="p-2 text-xs text-destructive">
						{errorMessage(files.error)}
						<button
							type="button"
							className="min-h-10 px-2 underline"
							onClick={() => void files.refetch()}
						>
							<Trans>Retry</Trans>
						</button>
					</div>
				)}
				{files.data?.files.length === 0 && (
					<p className="p-2 text-xs text-muted-foreground">
						<Trans>No changed files</Trans>
					</p>
				)}
				{files.data?.files.map((file) => (
					<button
						type="button"
						key={file.path}
						title={file.path}
						aria-pressed={selectedPath === file.path}
						onClick={() =>
							onSelectFile(file.path, file.oldPath, file.status === "deleted")
						}
						className={cn(
							"flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-accent",
							selectedPath === file.path && "bg-accent",
						)}
					>
						<span
							className={cn(
								"w-4 shrink-0 font-mono uppercase",
								file.status === "added"
									? "text-green-500"
									: file.status === "deleted"
										? "text-red-500"
										: "text-muted-foreground",
							)}
						>
							{file.status.slice(0, 1)}
						</span>
						<span className="min-w-0 flex-1 truncate">{file.path}</span>
					</button>
				))}
			</div>
		</aside>
	);
}
