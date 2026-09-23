import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { HiMiniCommandLine } from "react-icons/hi2";
import {
	getPresetIcon,
	useIsDarkTheme,
} from "renderer/assets/app-icons/preset-icons";
import { useBuiltinPresets } from "renderer/hooks/useBuiltinPresets";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { resolveV2PresetIcon } from "renderer/lib/preset-icon";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

interface WorkspaceCommandsPanelProps {
	runButton: ReactNode;
	matchedPresets: V2TerminalPresetRow[];
	executePreset: (preset: V2TerminalPresetRow) => void | Promise<void>;
}

export function WorkspaceCommandsPanel({
	runButton,
	matchedPresets,
	executePreset,
}: WorkspaceCommandsPanelProps) {
	const isDark = useIsDarkTheme();
	const { activeHostUrl } = useLocalHostService();
	const { data: agents } = useV2AgentConfigs(activeHostUrl);
	const builtinPresets = useBuiltinPresets();

	const scripts = [
		...matchedPresets
			.filter((preset) => preset.pinnedToBar !== false)
			.map((preset) => ({
				preset,
				icon: resolveV2PresetIcon(preset, agents, isDark),
			})),
		...builtinPresets
			.filter((entry) => entry.isVisible)
			.map(({ preset }) => ({
				preset,
				icon: getPresetIcon("superset", isDark),
			})),
	];

	return (
		<div className="flex flex-col gap-2">
			{runButton}
			{scripts.length > 0 && (
				<div className="flex flex-col gap-0.5">
					<span className="px-2.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
						<Trans>Scripts</Trans>
					</span>
					{scripts.map(({ preset, icon }) => (
						<button
							key={preset.id}
							type="button"
							onClick={() => void executePreset(preset)}
							className="flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
						>
							{icon ? (
								<img
									src={icon}
									alt=""
									className="size-4 shrink-0 object-contain"
								/>
							) : (
								<HiMiniCommandLine className="size-4 shrink-0" />
							)}
							<span className="min-w-0 flex-1 truncate">
								{preset.name || "default"}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
