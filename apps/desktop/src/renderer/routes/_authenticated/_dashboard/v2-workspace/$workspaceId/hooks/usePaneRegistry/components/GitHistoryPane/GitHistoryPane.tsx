import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@superset/ui/resizable";
import { workspaceTrpc } from "@superset/workspace-client";
import { GitGraph, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GitFilePaneData } from "../../../../types";
import { CommitDetails } from "./components/CommitDetails";
import { CommitList } from "./components/CommitList";

const inputClass =
	"h-10 min-w-0 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline focus-visible:outline-ring";

export function GitHistoryPane({
	workspaceId,
	onOpenFile,
}: {
	workspaceId: string;
	onOpenFile: (file: GitFilePaneData) => void;
}) {
	const { t } = useLingui();
	const [ref, setRef] = useState("HEAD");
	const [author, setAuthor] = useState("");
	const [search, setSearch] = useState("");
	const [since, setSince] = useState("");
	const [until, setUntil] = useState("");
	const [filters, setFilters] = useState({ author: "", search: "" });
	const [selection, setSelection] = useState<{
		hash: string;
		path?: string;
		oldPath?: string;
	}>();
	useEffect(() => {
		const timer = setTimeout(() => setFilters({ author, search }), 250);
		return () => clearTimeout(timer);
	}, [author, search]);
	const refs = workspaceTrpc.git.history.refs.useQuery({ workspaceId });
	const history = workspaceTrpc.git.history.list.useInfiniteQuery(
		{
			workspaceId,
			ref,
			...filters,
			since: since || undefined,
			until: until || undefined,
		},
		{ getNextPageParam: (page) => page.nextCursor },
	);
	const commits = useMemo(
		() => history.data?.pages.flatMap((page) => page.commits) ?? [],
		[history.data],
	);
	const selected =
		commits.find((commit) => commit.hash === selection?.hash) ?? commits[0];
	const path = selection?.hash === selected?.hash ? selection?.path : undefined;
	const error = refs.error ?? history.error;
	return (
		<div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background antialiased">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
				<GitGraph
					aria-hidden="true"
					className="mx-1 size-4 shrink-0 text-muted-foreground"
				/>
				<select
					aria-label={t({ message: "Branch" })}
					value={ref}
					onChange={(event) => {
						setRef(event.target.value);
						setSelection(undefined);
					}}
					className={`${inputClass} max-w-56`}
				>
					<option value="HEAD">{t({ message: "Current branch" })}</option>
					<option value="all">{t({ message: "All branches" })}</option>
					{refs.data?.refs.map((item) => (
						<option key={item.name} value={item.name}>
							{item.name.replace(/^refs\/(heads|remotes|tags)\//, "")}
						</option>
					))}
				</select>
				<input
					type="search"
					className={`${inputClass} w-44 flex-1`}
					aria-label={t({ message: "Search message or hash" })}
					placeholder={t({ message: "Search message or hash" })}
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<input
					className={`${inputClass} w-36`}
					aria-label={t({ message: "Author" })}
					placeholder={t({ message: "Author" })}
					value={author}
					onChange={(event) => setAuthor(event.target.value)}
				/>
				<label className="flex items-center gap-2 text-xs text-muted-foreground">
					<Trans>From</Trans>
					<input
						type="date"
						className={`${inputClass} w-36 tabular-nums`}
						value={since}
						max={until || undefined}
						onChange={(event) => setSince(event.target.value)}
					/>
				</label>
				<label className="flex items-center gap-2 text-xs text-muted-foreground">
					<Trans>To</Trans>
					<input
						type="date"
						className={`${inputClass} w-36 tabular-nums`}
						value={until}
						min={since || undefined}
						onChange={(event) => setUntil(event.target.value)}
					/>
				</label>
				<button
					type="button"
					aria-label={t({ message: "Refresh" })}
					title={t({ message: "Refresh" })}
					disabled={history.isFetching}
					onClick={() => {
						void refs.refetch();
						void history.refetch();
					}}
					className="flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40 transition-transform active:scale-[0.96] motion-reduce:transform-none"
				>
					<RefreshCw className="size-4" />
				</button>
			</div>
			{error && (
				<div role="alert" className="px-4 py-2 text-xs text-destructive">
					{errorMessage(error)}
					<button
						type="button"
						className="min-h-10 px-2 underline"
						onClick={() => {
							void refs.refetch();
							void history.refetch();
						}}
					>
						<Trans>Retry</Trans>
					</button>
				</div>
			)}
			<ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
				<ResizablePanel
					defaultSize={75}
					minSize={25}
					className="flex min-w-0 flex-col"
				>
					{history.isPending ? (
						<output className="p-6 text-sm text-muted-foreground">
							<Trans>Loading</Trans>
						</output>
					) : commits.length === 0 && !error ? (
						<div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
							<Trans>No commits found</Trans>
						</div>
					) : (
						<CommitList
							commits={commits}
							selected={selected?.hash}
							onSelect={(hash) => setSelection({ hash })}
						/>
					)}
					{history.hasNextPage && (
						<button
							type="button"
							disabled={history.isFetchingNextPage}
							onClick={() => void history.fetchNextPage()}
							className="min-h-10 shrink-0 border-t text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
						>
							<Trans>Load more</Trans>
						</button>
					)}
				</ResizablePanel>
				{selected && refs.data && (
					<>
						<ResizableHandle withHandle />
						<ResizablePanel defaultSize={25} minSize={15}>
							<CommitDetails
								workspaceId={workspaceId}
								commit={selected}
								emptyTree={refs.data.emptyTree}
								selectedPath={path}
								onSelectFile={(path, oldPath, deleted) => {
									setSelection({ hash: selected.hash, path, oldPath });
									onOpenFile({
										filePath: deleted ? (oldPath ?? path) : path,
										commitHash: selected.hash,
										fromHash: selected.parents[0] ?? refs.data.emptyTree,
										side: deleted ? "old" : "new",
									});
								}}
							/>
						</ResizablePanel>
					</>
				)}
			</ResizablePanelGroup>
		</div>
	);
}
