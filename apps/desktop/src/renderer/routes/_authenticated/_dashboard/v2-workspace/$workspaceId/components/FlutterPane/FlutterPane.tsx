import { Trans } from "@lingui/react/macro";
import type { RendererContext } from "@superset/panes";
import { useWorkspaceClient, workspaceTrpc } from "@superset/workspace-client";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { browserRuntimeRegistry } from "../../hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistry";
import type { FlutterPaneData, PaneViewerData } from "../../types";

export function FlutterPane({ ctx }: { ctx: RendererContext<PaneViewerData> }) {
	const { workspace } = useWorkspace();
	const { trpcClient } = useWorkspaceClient();
	const data = ctx.pane.data as FlutterPaneData;
	const status = workspaceTrpc.flutter.status.useQuery(
		{ workspaceId: workspace.id },
		{ refetchInterval: 1000 },
	);
	const placeholder = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string>();
	const current = status.data?.id === data.sessionId ? status.data : null;
	const inspect = ctx.pane.kind === "flutter-inspector";
	const available = current?.canInspect === true;
	useEffect(() => {
		if (!inspect || !available) return;
		let disposed = false;
		const paneId = ctx.pane.id;
		void trpcClient.flutter.inspector
			.mutate({ workspaceId: workspace.id, sessionId: data.sessionId })
			.then((url) => {
				if (disposed || !placeholder.current) return;
				browserRuntimeRegistry.attach(
					paneId,
					placeholder.current,
					url,
					workspace.id,
					() => {},
					() => {},
				);
			})
			.catch((error) => {
				if (!disposed) setError(String(error));
			});
		return () => {
			disposed = true;
			browserRuntimeRegistry.detach(paneId);
			browserRuntimeRegistry.destroy(paneId);
		};
	}, [
		inspect,
		available,
		ctx.pane.id,
		data.sessionId,
		workspace.id,
		trpcClient,
	]);
	if (!inspect)
		return (
			<pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs">
				{current?.output ?? <Trans>Flutter session ended</Trans>}
			</pre>
		);
	return (
		<div className="relative h-full w-full">
			{error || !available ? (
				<div className="p-4 text-sm">
					{error ?? (
						<Trans>Inspector is available for a running debug session</Trans>
					)}
				</div>
			) : (
				<div ref={placeholder} className="h-full w-full" />
			)}
		</div>
	);
}
