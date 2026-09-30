import { useLingui } from "@lingui/react/macro";
import { useActivePaneContext, type WorkspaceProps } from "@superset/panes";
import { PanelTop } from "lucide-react";
import { useMemo } from "react";
import type { WorkspacePanelActionTab } from "../../components/WorkspaceSidebar/components/WorkspaceActionDock";
import type { PaneViewerData } from "../../types";
import { PanelActionContent } from "./components/PanelActionContent";
import { getPanelActionDefinition } from "./getPanelActionTab";

export function usePanelActionTab({
	store,
	registry,
	paneActions,
	enabled,
}: Pick<
	WorkspaceProps<PaneViewerData>,
	"store" | "registry" | "paneActions"
> & { enabled: boolean }) {
	const { t } = useLingui();
	const context = useActivePaneContext({ store, registry, paneActions });
	return useMemo<WorkspacePanelActionTab | null>(() => {
		const definition = enabled
			? getPanelActionDefinition(context, registry)
			: null;
		if (!context || !definition) return null;
		const labels: Record<string, string> = {
			file: t({ message: "File" }),
			terminal: t({ message: "Terminal" }),
			diff: t({ message: "Changes" }),
			browser: t({ message: "Browser" }),
			comment: t({ message: "Comment" }),
			"pull-request": t({ message: "Pull Request" }),
			page: t({ message: "Page" }),
		};
		return {
			paneId: context.pane.id,
			label: labels[context.pane.kind] ?? t({ message: "Panel" }),
			icon: definition.getTabIcon?.(context) ??
				definition.getIcon?.(context) ?? <PanelTop className="size-4" />,
			content: (
				<PanelActionContent
					key={context.pane.id}
					context={context}
					registry={registry}
				/>
			),
		};
	}, [context, registry, enabled, t]);
}
