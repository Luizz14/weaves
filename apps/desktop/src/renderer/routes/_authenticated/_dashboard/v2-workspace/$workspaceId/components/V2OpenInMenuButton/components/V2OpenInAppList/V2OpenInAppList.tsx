import { Trans } from "@lingui/react/macro";
import type { ExternalApp } from "@superset/local-db";
import { cn } from "@superset/ui/utils";
import type { KeyboardEvent, ReactNode } from "react";
import { LuCopy } from "react-icons/lu";
import { getAppOption } from "renderer/components/OpenInExternalDropdown";
import { LIST_APP_IDS } from "./constants";

interface V2OpenInAppListProps {
	isDark: boolean;
	activeApp: ExternalApp;
	disabled: boolean;
	onOpenIn: (app: ExternalApp) => void;
	onCopyPath: () => void;
}

const ITEM_CLASS =
	"flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

export function V2OpenInAppList({
	isDark,
	activeApp,
	disabled,
	onOpenIn,
	onCopyPath,
}: V2OpenInAppListProps) {
	const apps = LIST_APP_IDS.flatMap((id) => {
		const option = getAppOption(id);
		return option ? [option] : [];
	});
	const actions = [...apps.map((app) => () => onOpenIn(app.id)), onCopyPath];

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const index = Number(event.key) - 1;
		const action = actions[index];
		if (!action || disabled) return;
		event.preventDefault();
		action();
	};

	const renderItem = (
		key: string,
		index: number,
		icon: ReactNode,
		label: ReactNode,
		onClick: () => void,
		active = false,
	) => (
		<button
			key={key}
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={cn(ITEM_CLASS, active && "bg-muted/60")}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<span className="text-xs tabular-nums text-muted-foreground">
				{index + 1}
			</span>
		</button>
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: number keys shortcut the focused list
		<div className="flex flex-col gap-0.5" onKeyDown={handleKeyDown}>
			{apps.map((app, index) =>
				renderItem(
					app.id,
					index,
					<img
						src={isDark ? app.darkIcon : app.lightIcon}
						alt=""
						className="size-4 shrink-0 object-contain"
					/>,
					app.displayLabel ?? app.label,
					() => onOpenIn(app.id),
					app.id === activeApp,
				),
			)}
			{renderItem(
				"copy-path",
				apps.length,
				<LuCopy className="size-4 shrink-0" />,
				<Trans>Copy path</Trans>,
				onCopyPath,
			)}
		</div>
	);
}
