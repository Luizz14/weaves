import { Trans } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import type { RendererContext } from "@superset/panes";
import { useWorkspaceClient, workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useMemo } from "react";
import { MarkdownResourceProvider } from "renderer/components/MarkdownRenderer/providers/MarkdownResourceProvider";
import {
	type ContentState,
	decodeBase64,
} from "../../../../state/fileDocumentStore";
import type { GitFilePaneData, PaneViewerData } from "../../../../types";
import { createSnapshotDocument } from "../../utils/createSnapshotDocument";
import { ErrorState } from "../FilePane/components/ErrorState";
import { FileViewToggle } from "../FilePane/components/FileViewToggle";
import { LoadingState } from "../FilePane/components/LoadingState";
import { ALL_VIEWS, orderForToggle, resolveViews } from "../FilePane/registry";

export function GitFilePane({
	context,
	workspaceId,
}: {
	context: RendererContext<PaneViewerData>;
	workspaceId: string;
}) {
	const data = context.pane.data as GitFilePaneData;
	const { trpcClient } = useWorkspaceClient();
	const query = workspaceTrpc.git.readDiffSideFile.useQuery(
		{
			workspaceId,
			category: "commit",
			commitHash: data.commitHash,
			fromHash: data.fromHash,
			side: data.side,
			path: data.filePath,
		},
		{ staleTime: Infinity },
	);
	const revision = data.side === "old" ? data.fromHash : data.commitHash;
	const bytes = useMemo(
		() =>
			query.data?.kind === "bytes" && query.data.content !== null
				? decodeBase64(query.data.content)
				: null,
		[query.data],
	);
	const views = resolveViews(data.filePath, {
		isBinary: bytes?.subarray(0, 8192).includes(0),
		size: bytes?.byteLength,
	});
	const view = data.forceViewId
		? ALL_VIEWS.find((view) => view.id === data.forceViewId)
		: (views.find((view) => view.id === data.viewId) ?? views[0]);
	const content = useMemo<ContentState>(
		() =>
			bytes
				? view?.documentKind === "bytes"
					? { kind: "bytes", value: bytes, revision }
					: { kind: "text", value: new TextDecoder().decode(bytes), revision }
				: { kind: "loading" },
		[bytes, view?.documentKind, revision],
	);
	const document = useMemo(
		() =>
			createSnapshotDocument({
				workspaceId,
				absolutePath: data.filePath,
				content,
			}),
		[workspaceId, data.filePath, content],
	);
	const readResource = useCallback(
		async (path: string) => {
			const result = await trpcClient.git.readDiffSideFile.query({
				workspaceId,
				category: "commit",
				commitHash: data.commitHash,
				fromHash: data.fromHash,
				side: data.side,
				path: path.replace(/^\//, ""),
			});
			if (result.kind !== "bytes" || result.content === null)
				throw new Error("Git resource unavailable");
			return decodeBase64(result.content);
		},
		[trpcClient, workspaceId, data.commitHash, data.fromHash, data.side],
	);
	if (query.isPending) return <LoadingState />;
	if (query.error)
		return (
			<ErrorState
				reason="load-failed"
				message={errorMessage(query.error)}
				onRetry={() => void query.refetch()}
			/>
		);
	if (query.data?.kind === "missing") return <ErrorState reason="not-found" />;
	if (query.data?.exceededLimit) return <ErrorState reason="too-large" />;
	if (!view) return <ErrorState reason="binary-unsupported" />;
	const Renderer = view.Renderer;
	const changeView = (viewId: string) =>
		context.actions.updateData({ ...data, viewId });
	return (
		<div className="flex h-full w-full min-w-0 flex-1 flex-col">
			<div className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 text-xs text-muted-foreground">
				<span>
					<Trans>Read only</Trans>
				</span>
				<span className="font-mono" title={revision}>
					{revision.slice(0, 12)}
				</span>
				{data.side === "old" && (
					<span>
						<Trans>Deleted</Trans> · <Trans>Compared with first parent</Trans>
					</span>
				)}
				<span className="min-w-0 flex-1 truncate" title={data.filePath}>
					{data.filePath}
				</span>
				{views.length > 1 && !data.forceViewId && (
					<FileViewToggle
						views={orderForToggle(views)}
						activeViewId={view.id}
						filePath={data.filePath}
						onChange={changeView}
					/>
				)}
			</div>
			<div className="min-h-0 min-w-0 flex-1">
				<MarkdownResourceProvider
					documentDirectory={`/${data.filePath.split("/").slice(0, -1).join("/")}`}
					rootPath="/"
					revision={revision}
					readFile={readResource}
				>
					<Renderer
						key={document.id}
						document={document}
						filePath={data.filePath}
						workspaceId={workspaceId}
						paneId={context.pane.id}
						isActive={context.isActive}
						readOnly
						showFrontMatterNote={false}
						onChangeView={changeView}
						onForceView={(viewId) =>
							context.actions.updateData({
								...data,
								viewId,
								forceViewId: viewId,
							})
						}
					/>
				</MarkdownResourceProvider>
			</div>
		</div>
	);
}
