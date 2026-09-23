import { Trans, useLingui } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Play, Settings, Square, X } from "lucide-react";
import { useCallback } from "react";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { useSetSettingsSearchQuery } from "renderer/stores/settings-state";
import {
	getWorkspaceRunDefinitionId,
	type WorkspaceRunDefinition,
} from "shared/workspace-run-definition";

interface V2WorkspaceRunButtonProps {
	/** Null for project-less "session" workspaces (no project scripts page). */
	projectId: string | null;
	definition: WorkspaceRunDefinition | null;
	definitions: WorkspaceRunDefinition[];
	onRunDefinition: (definition: WorkspaceRunDefinition) => void | Promise<void>;
	isRunning: boolean;
	isPending: boolean;
	canForceStop: boolean;
	onToggle: () => void | Promise<void>;
	onForceStop: () => void | Promise<void>;
	appearance?: "toolbar" | "dock";
}

export function V2WorkspaceRunButton({
	projectId,
	definition,
	definitions,
	onRunDefinition,
	isRunning,
	isPending,
	canForceStop,
	onToggle,
	onForceStop,
	appearance = "toolbar",
}: V2WorkspaceRunButtonProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const setSettingsSearchQuery = useSetSettingsSearchQuery();
	const hotkeyText = useHotkeyDisplay("RUN_WORKSPACE_COMMAND").text;
	const hasRunCommand = (definition?.commands ?? []).length > 0;

	const handleConfigureClick = useCallback(() => {
		if (definition?.source === "terminal-preset") {
			void navigate({
				to: "/settings/terminal",
				search: { editPresetId: definition.presetId },
			});
			return;
		}

		// Sessions have no project settings page; global presets are the only
		// configurable run source, handled by the terminal-preset branch above.
		if (projectId === null) {
			void navigate({ to: "/settings/terminal" });
			return;
		}
		setSettingsSearchQuery("scripts");
		void navigate({
			to: "/settings/projects/$projectId",
			params: { projectId },
		});
	}, [definition, navigate, projectId, setSettingsSearchQuery]);

	const selectedId = definition
		? getWorkspaceRunDefinitionId(definition)
		: null;
	const definitionLabel = (candidate: WorkspaceRunDefinition) =>
		candidate.source === "terminal-preset"
			? candidate.name
			: t({ message: "Project run script" });

	const label = isRunning
		? t({ message: "Stop" })
		: hasRunCommand
			? t({ message: "Run" })
			: t({ message: "Set Run" });
	const Icon = isRunning ? Square : hasRunCommand ? Play : Settings;
	const inDock = appearance === "dock";

	return (
		<div
			className={`flex shrink-0 items-center no-drag ${inDock ? "w-full" : ""}`}
		>
			<button
				type="button"
				onClick={() => {
					if (!hasRunCommand && !isRunning) {
						handleConfigureClick();
						return;
					}
					void onToggle();
				}}
				disabled={isPending}
				className={cn(
					inDock
						? "group flex h-10 min-w-0 flex-1 items-center gap-3 rounded-l-xl border border-r-0 border-border/60 bg-transparent px-3 text-left text-sm font-medium text-foreground transition-[background-color,color,transform] active:scale-[0.96]"
						: "group flex h-6 items-center gap-1.5 rounded-l-md border border-r-0 border-border/50 bg-transparent px-2 text-xs font-medium text-foreground transition-colors",
					"hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					isPending && "pointer-events-none opacity-50",
					isRunning
						? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/[0.12]"
						: hasRunCommand
							? "text-foreground"
							: "text-muted-foreground/80 hover:text-foreground",
				)}
				aria-label={
					isRunning
						? t({
								message: "Stop workspace run command",
							})
						: hasRunCommand
							? t({
									message: "Run workspace command",
								})
							: t({
									message: "Configure workspace run command",
								})
				}
			>
				<Icon className={cn(inDock ? "size-4" : "size-3", "shrink-0")} />
				<span className="truncate">{label}</span>
				{hotkeyText && hotkeyText !== "Unassigned" && (
					<span className="hidden text-[10px] tracking-wide text-muted-foreground/60 sm:inline">
						{hotkeyText}
					</span>
				)}
			</button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						disabled={isPending}
						className={cn(
							inDock
								? "flex h-10 w-10 shrink-0 items-center justify-center rounded-r-xl border border-border/60 bg-transparent text-muted-foreground transition-[background-color,color,transform] active:scale-[0.96]"
								: "flex size-6 items-center justify-center rounded-r-md border border-border/50 bg-transparent text-muted-foreground transition-colors",
							"hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							isPending && "pointer-events-none opacity-50",
							isRunning &&
								"border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/[0.12]",
						)}
						aria-label={t({
							message: "Workspace run options",
						})}
					>
						<ChevronDown className={cn(inDock ? "size-4" : "size-3")} />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-56"
					data-workspace-action-dock-portal={inDock ? "true" : undefined}
				>
					{definitions.length > 1 && (
						<>
							{definitions.map((candidate) => {
								const id = getWorkspaceRunDefinitionId(candidate);
								return (
									<DropdownMenuItem
										key={id}
										onClick={() => void onRunDefinition(candidate)}
									>
										{id === selectedId ? (
											<Check className="mr-2 size-4" />
										) : (
											<Play className="mr-2 size-4 opacity-60" />
										)}
										<span className="truncate">
											{definitionLabel(candidate)}
										</span>
									</DropdownMenuItem>
								);
							})}
							<DropdownMenuSeparator />
						</>
					)}
					{canForceStop && (
						<>
							<DropdownMenuItem
								onClick={() => void onForceStop()}
								className="text-destructive focus:text-destructive"
							>
								<X className="mr-2 size-4 text-destructive" />
								<Trans>Force Stop</Trans>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem onClick={handleConfigureClick}>
						<Settings className="mr-2 size-4" />
						{definition?.source === "terminal-preset"
							? t({
									message: "Edit Run Script",
								})
							: t({
									message: "Configure",
								})}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
