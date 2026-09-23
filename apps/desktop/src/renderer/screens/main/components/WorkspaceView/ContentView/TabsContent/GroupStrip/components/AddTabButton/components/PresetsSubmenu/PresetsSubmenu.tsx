import type { TerminalPreset } from "@superset/local-db";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { HiMiniCog6Tooth, HiMiniCommandLine } from "react-icons/hi2";
import {
	getPresetIcon,
	useIsDarkTheme,
} from "renderer/assets/app-icons/preset-icons";

interface PresetsSubmenuProps {
	presets: TerminalPreset[];
	onOpenPreset: (preset: TerminalPreset) => void;
	onConfigurePresets: () => void;
}

export function PresetsSubmenu({
	presets,
	onOpenPreset,
	onConfigurePresets,
}: PresetsSubmenuProps) {
	const isDark = useIsDarkTheme();

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className="gap-2">
				<HiMiniCommandLine className="size-4" />
				<span>Terminal Scripts</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="w-56">
				{presets.length > 0 ? (
					presets.map((preset) => {
						const presetIcon = getPresetIcon(preset.name, isDark);
						return (
							<DropdownMenuItem
								key={preset.id}
								onClick={() => onOpenPreset(preset)}
								className="gap-2"
							>
								{presetIcon ? (
									<img
										src={presetIcon}
										alt=""
										className="size-4 object-contain"
									/>
								) : (
									<HiMiniCommandLine className="size-4" />
								)}
								<span className="truncate">{preset.name || "default"}</span>
							</DropdownMenuItem>
						);
					})
				) : (
					<DropdownMenuItem disabled>No terminal scripts</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={onConfigurePresets} className="gap-2">
					<HiMiniCog6Tooth className="size-4" />
					<span>Configure Terminal Scripts</span>
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
