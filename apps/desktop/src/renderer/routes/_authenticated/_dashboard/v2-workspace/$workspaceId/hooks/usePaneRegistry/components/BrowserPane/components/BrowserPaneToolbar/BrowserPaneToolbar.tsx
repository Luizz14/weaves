import type { RendererContext } from "@superset/panes";
import { useCallback } from "react";
import type { PaneViewerData } from "../../../../../../types";
import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { useBrowserState } from "../../hooks/useBrowserState";
import { BrowserPaneActions } from "../BrowserPaneActions";
import { BrowserToolbar } from "../BrowserToolbar";

interface BrowserPaneToolbarProps {
	ctx: RendererContext<PaneViewerData>;
}

export function BrowserPaneToolbar({ ctx }: BrowserPaneToolbarProps) {
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);

	const handleGoBack = useCallback(() => {
		browserRuntimeRegistry.goBack(paneId);
	}, [paneId]);

	const handleGoForward = useCallback(() => {
		browserRuntimeRegistry.goForward(paneId);
	}, [paneId]);

	const handleReload = useCallback(() => {
		browserRuntimeRegistry.reload(paneId);
	}, [paneId]);

	const handleNavigate = useCallback(
		(url: string) => {
			browserRuntimeRegistry.navigate(paneId, url);
		},
		[paneId],
	);

	return (
		<div className="@container/browser-toolbar flex h-full w-full min-w-0 items-center justify-between">
			<BrowserToolbar
				paneId={paneId}
				currentUrl={state.currentUrl}
				faviconUrl={state.faviconUrl}
				isLoading={state.isLoading}
				canGoBack={state.canGoBack}
				canGoForward={state.canGoForward}
				onGoBack={handleGoBack}
				onGoForward={handleGoForward}
				onReload={handleReload}
				onNavigate={handleNavigate}
			/>
			{ctx.pane.parentDirection !== null && <BrowserPaneActions ctx={ctx} />}
		</div>
	);
}
