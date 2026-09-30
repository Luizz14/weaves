import { useLingui } from "@lingui/react/macro";
import { TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { SquarePen } from "lucide-react";
import {
	PaneActionButton,
	PaneActionTooltip as Tooltip,
	usePaneActionDock,
} from "renderer/components/PaneActionButton";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { SubagentPaneData } from "../../../../../../types";
import {
	terminalRichInputOpenStore,
	useTerminalRichInputOpen,
} from "../../richInputOpenStore";
import { TerminalAccountUsage } from "./components/TerminalAccountUsage";
import { TerminalConnectionIndicator } from "./components/TerminalConnectionIndicator";
import { TerminalIdCopyMenu } from "./components/TerminalIdCopyMenu";
import { TerminalPageWatchChip } from "./components/TerminalPageWatchChip";
import { TerminalSessionHandoffMenu } from "./components/TerminalSessionHandoffMenu";
import { TerminalSubagentsMenu } from "./components/TerminalSubagentsMenu";

interface TerminalPaneHeaderExtrasProps {
	variant?: "header" | "menu";
	workspaceId: string;
	terminalId: string;
	terminalInstanceId: string;
	onCreateNewAgentSession: (input: {
		configId: string;
		placement: "split-pane" | "new-tab";
		prompt: string;
		forkSessionId?: string;
	}) => Promise<{ terminalId: string } | null>;
	/** Open (or focus) the live transcript pane for one of this agent's subagents. */
	onOpenSubagent: (data: SubagentPaneData) => void;
}

/**
 * Header affordance that opens the rich-input overlay, so the ⌘I composer is
 * discoverable without knowing the shortcut. Toggles the same shared open-state
 * the hotkey drives; the tooltip carries the shortcut as the teach path.
 * Also hosts the connection indicator and identifier copy menu.
 */
export function TerminalPaneHeaderExtras({
	variant = "header",
	workspaceId,
	terminalId,
	terminalInstanceId,
	onCreateNewAgentSession,
	onOpenSubagent,
}: TerminalPaneHeaderExtrasProps) {
	const inDock = usePaneActionDock();
	const { t } = useLingui();
	const isOpen = useTerminalRichInputOpen();
	const hotkeyText = useHotkeyDisplay("TOGGLE_TERMINAL_RICH_INPUT").text;
	const label =
		hotkeyText === "Unassigned"
			? t({
					message: "Rich input",
				})
			: t({
					message: `Rich input (${hotkeyText})`,
				});

	return (
		<div
			className={cn(
				"flex items-center gap-1",
				inDock
					? "flex-col items-stretch gap-0.5"
					: variant === "menu" && "flex-wrap",
			)}
		>
			<TerminalAccountUsage
				key={`${workspaceId}:${terminalId}`}
				workspaceId={workspaceId}
				terminalId={terminalId}
			/>
			<TerminalSubagentsMenu
				compact={variant === "header"}
				workspaceId={workspaceId}
				terminalId={terminalId}
				onOpenSubagent={onOpenSubagent}
			/>
			<TerminalConnectionIndicator
				terminalId={terminalId}
				terminalInstanceId={terminalInstanceId}
			/>
			<TerminalPageWatchChip
				compact={variant === "header"}
				workspaceId={workspaceId}
				terminalId={terminalId}
			/>
			<TerminalIdCopyMenu
				workspaceId={workspaceId}
				terminalId={terminalId}
				triggerClassName={variant === "menu" ? "block" : undefined}
			/>
			{variant === "header" && (
				<TerminalSessionHandoffMenu
					workspaceId={workspaceId}
					terminalId={terminalId}
					onCreateNewAgentSession={onCreateNewAgentSession}
				/>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<PaneActionButton
						type="button"
						onClick={() => terminalRichInputOpenStore.toggle("header_button")}
						aria-label={label}
						aria-pressed={isOpen}
						className={cn(
							// ⌘I still opens it; the button yields to split/close first.
							"rounded p-1 transition-colors",
							variant === "header"
								? "hidden @min-[200px]/pane-header:block"
								: "block",
							isOpen
								? "bg-secondary text-foreground"
								: "text-muted-foreground/60 hover:text-muted-foreground",
						)}
						label={label}
						icon={<SquarePen className="size-3.5" />}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
		</div>
	);
}
