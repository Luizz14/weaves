import { Trans, useLingui } from "@lingui/react/macro";
import type { RendererContext } from "@superset/panes";
import { TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useCallback } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { TbExternalLink, TbFolderOpen } from "react-icons/tb";
import {
	PaneActionButton,
	PaneActionTooltip as Tooltip,
	usePaneActionDock,
} from "renderer/components/PaneActionButton";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useOpenInExternalEditor } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useOpenInExternalEditor";
import { useSharedFileDocument } from "../../../../../../state/fileDocumentStore";
import type { FilePaneData, PaneViewerData } from "../../../../../../types";
import { orderForToggle, resolveActivePaneView } from "../../registry";
import { FileViewToggle } from "../FileViewToggle";

interface FilePaneHeaderExtrasProps {
	context: RendererContext<PaneViewerData>;
	workspaceId: string;
}

export function FilePaneHeaderExtras({
	context,
	workspaceId,
}: FilePaneHeaderExtrasProps) {
	const inDock = usePaneActionDock();
	const { t } = useLingui();
	const data = context.pane.data as FilePaneData;
	const { filePath } = data;
	const openInExternalEditor = useOpenInExternalEditor(workspaceId);
	const openInFinderMutation = electronTrpc.external.openInFinder.useMutation();
	const { copyToClipboard, copied } = useCopyToClipboard();

	const document = useSharedFileDocument({
		workspaceId,
		absolutePath: filePath,
	});

	const handleChangeView = useCallback(
		(viewId: string) => {
			context.actions.updateData({
				...data,
				viewId,
			} as PaneViewerData);
		},
		[context.actions, data],
	);

	const { views, activeView } = resolveActivePaneView(document, data);
	const shouldShowToggle =
		views.length > 1 && !data.forceViewId && activeView !== null;

	const handleOpenExternal = useCallback(() => {
		openInExternalEditor(filePath);
	}, [filePath, openInExternalEditor]);

	const handleOpenInFinder = useCallback(() => {
		openInFinderMutation.mutate(filePath);
	}, [filePath, openInFinderMutation]);

	return (
		<div
			className={
				inDock
					? "flex min-w-0 flex-col gap-0.5"
					: "flex min-w-0 items-center gap-1"
			}
		>
			{shouldShowToggle && activeView && (
				<FileViewToggle
					views={orderForToggle(views)}
					activeViewId={activeView.id}
					filePath={filePath}
					onChange={handleChangeView}
				/>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						aria-label={t({
							message: "Copy path",
						})}
						onClick={() => void copyToClipboard(filePath)}
						className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
						label={t({
							message: "Copy path",
						})}
						icon={
							copied ? (
								<LuCheck className="size-3.5" />
							) : (
								<LuCopy className="size-3.5" />
							)
						}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{copied ? <Trans>Copied</Trans> : <Trans>Copy path</Trans>}
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						aria-label={t({
							message: "Reveal in Finder",
						})}
						onClick={handleOpenInFinder}
						className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
						label={t({
							message: "Reveal in Finder",
						})}
						icon={<TbFolderOpen className="size-3.5" />}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<Trans>Reveal in Finder</Trans>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						aria-label={t({
							message: "Open in editor",
						})}
						onClick={handleOpenExternal}
						className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
						label={t({
							message: "Open in editor",
						})}
						icon={<TbExternalLink className="size-3.5" />}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<Trans>Open in editor</Trans>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
