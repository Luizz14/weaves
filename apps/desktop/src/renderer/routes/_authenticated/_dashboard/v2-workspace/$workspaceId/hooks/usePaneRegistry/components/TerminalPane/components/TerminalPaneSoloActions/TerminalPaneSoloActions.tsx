import type { RendererContext } from "@superset/panes";
import type { PaneViewerData, TerminalPaneData } from "../../../../../../types";
import type { TerminalLauncher } from "../../../../../useV2TerminalLauncher";
import { TerminalPaneHeaderExtras } from "../TerminalPaneHeaderExtras";
import { TerminalSessionHandoffMenu } from "../TerminalPaneHeaderExtras/components/TerminalSessionHandoffMenu";
import { TerminalSessionDropdown } from "../TerminalSessionDropdown";

interface TerminalPaneSoloActionsProps {
	context: RendererContext<PaneViewerData>;
	workspaceId: string;
	launcher: TerminalLauncher;
	onCreateNewAgentSession: React.ComponentProps<
		typeof TerminalPaneHeaderExtras
	>["onCreateNewAgentSession"];
	onOpenSubagent: React.ComponentProps<
		typeof TerminalPaneHeaderExtras
	>["onOpenSubagent"];
}

export function TerminalPaneSoloActions({
	context,
	workspaceId,
	launcher,
	onCreateNewAgentSession,
	onOpenSubagent,
}: TerminalPaneSoloActionsProps) {
	const { terminalId } = context.pane.data as TerminalPaneData;
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<TerminalSessionDropdown
				context={context}
				launcher={launcher}
				workspaceId={workspaceId}
			/>
			<div className="flex flex-col gap-0.5">
				<TerminalSessionHandoffMenu
					workspaceId={workspaceId}
					terminalId={terminalId}
					onCreateNewAgentSession={onCreateNewAgentSession}
					triggerClassName="block"
				/>
				<TerminalPaneHeaderExtras
					variant="menu"
					workspaceId={workspaceId}
					terminalId={terminalId}
					terminalInstanceId={context.pane.id}
					onCreateNewAgentSession={onCreateNewAgentSession}
					onOpenSubagent={onOpenSubagent}
				/>
			</div>
		</div>
	);
}
