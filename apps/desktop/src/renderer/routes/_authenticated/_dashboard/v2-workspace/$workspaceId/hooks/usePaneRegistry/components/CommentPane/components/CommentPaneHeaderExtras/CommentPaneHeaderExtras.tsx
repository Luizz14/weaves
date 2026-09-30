import { Trans, useLingui } from "@lingui/react/macro";
import type { RendererContext } from "@superset/panes";
import { TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { LuCheck, LuCopy } from "react-icons/lu";
import {
	PANE_DOCK_ACTION_CLASS_NAME,
	PaneActionButton,
	PaneActionTooltip as Tooltip,
	usePaneActionDock,
} from "renderer/components/PaneActionButton";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CommentPaneData, PaneViewerData } from "../../../../../../types";

interface CommentPaneHeaderExtrasProps {
	context: RendererContext<PaneViewerData>;
}

export function CommentPaneHeaderExtras({
	context,
}: CommentPaneHeaderExtrasProps) {
	const { t } = useLingui();
	const inDock = usePaneActionDock();
	const data = context.pane.data as CommentPaneData;
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isMountedRef = useRef(true);

	useEffect(() => {
		return () => {
			isMountedRef.current = false;
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
		};
	}, []);

	const handleCopyAll = useCallback(() => {
		void electronTrpcClient.external.copyText
			.mutate(data.body)
			.then(() => {
				if (!isMountedRef.current) return;
				if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
				setCopied(true);
				copyTimerRef.current = setTimeout(() => {
					if (!isMountedRef.current) return;
					setCopied(false);
					copyTimerRef.current = null;
				}, 1500);
			})
			.catch((err) => {
				console.warn("Failed to copy comment text", err);
			});
	}, [data.body]);

	return (
		<>
			{data.url && (
				<Tooltip>
					<TooltipTrigger asChild>
						<a
							href={data.url}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={t({
								message: "Open on GitHub",
							})}
							className={cn(
								"rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground",
								inDock && PANE_DOCK_ACTION_CLASS_NAME,
								inDock &&
									"[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
							)}
						>
							<FaGithub className="size-3.5" />
							{inDock && (
								<span className="min-w-0 truncate">
									<Trans>Open on GitHub</Trans>
								</span>
							)}
						</a>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<Trans>Open on GitHub</Trans>
					</TooltipContent>
				</Tooltip>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						aria-label={t({
							message: "Copy comment",
						})}
						onClick={handleCopyAll}
						className={cn(
							"rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground",
							inDock && PANE_DOCK_ACTION_CLASS_NAME,
							inDock &&
								"[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
						)}
						label={t({
							message: "Copy comment",
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
					{copied ? <Trans>Copied</Trans> : <Trans>Copy comment</Trans>}
				</TooltipContent>
			</Tooltip>
		</>
	);
}
