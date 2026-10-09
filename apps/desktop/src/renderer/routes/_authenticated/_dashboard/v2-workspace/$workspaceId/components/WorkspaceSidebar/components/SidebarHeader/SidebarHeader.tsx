import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import {
	AnimatePresence,
	LayoutGroup,
	motion,
	useReducedMotion,
} from "motion/react";
import { useId } from "react";
import { SPRING_LAYOUT } from "renderer/lib/ease";
import { WindowControlsInset } from "renderer/routes/_authenticated/_dashboard/components/WindowControlsInset";
import type { SidebarTabDefinition } from "../../types";

interface SidebarHeaderProps {
	tabs: SidebarTabDefinition[];
	activeTab: string;
	onTabChange: (id: string) => void;
	compact?: boolean;
}

export function SidebarHeader({
	tabs,
	activeTab,
	onTabChange,
	compact,
}: SidebarHeaderProps) {
	const layoutGroupId = useId();
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : SPRING_LAYOUT;
	const actions = tabs.find((t) => t.id === activeTab)?.actions;

	return (
		<div className="flex h-10 shrink-0 items-center gap-1 bg-muted/45 shadow-[inset_0_-1px_0_var(--border)] pl-2 dark:bg-muted/35">
			<LayoutGroup id={layoutGroupId}>
				<div className="no-drag flex min-w-0 items-center gap-0.5">
					{tabs.map((tab) => {
						const isActive = activeTab === tab.id;
						const showLabel = isActive && !compact;
						const badge =
							typeof tab.badge === "number" && tab.badge > 0
								? formatBadgeCount(tab.badge)
								: null;
						const label = badge ? `${tab.label} (${badge})` : tab.label;

						const button = (
							<motion.button
								layout="position"
								transition={transition}
								type="button"
								onClick={() => onTabChange(tab.id)}
								aria-label={label}
								aria-pressed={isActive}
								className={cn(
									"relative isolate flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-colors",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									isActive
										? "text-foreground"
										: "text-muted-foreground hover:bg-fill-hover hover:text-foreground",
								)}
							>
								{isActive && (
									<motion.span
										layoutId="workspace-sidebar-active-tab"
										transition={transition}
										className="surface-outline pointer-events-none absolute inset-0 -z-10 rounded-lg bg-background outline-[1.5px]"
									/>
								)}
								{tab.icon && <tab.icon className="size-3.5 shrink-0" />}
								<AnimatePresence initial={false}>
									{showLabel && (
										<motion.span
											key="label"
											initial={{ width: 0, opacity: 0 }}
											animate={{ width: "auto", opacity: 1 }}
											exit={{ width: 0, opacity: 0 }}
											transition={transition}
											className="overflow-hidden whitespace-nowrap font-medium"
										>
											{tab.label}
										</motion.span>
									)}
								</AnimatePresence>
								{badge && (
									<span
										aria-hidden="true"
										className={cn(
											"shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium leading-4 tabular-nums text-muted-foreground",
											showLabel
												? "bg-fill-selected text-foreground"
												: "absolute -right-0.5 -top-0.5 min-w-3 px-1 text-[9px] leading-3",
										)}
									>
										{badge}
									</span>
								)}
							</motion.button>
						);

						return (
							<Tooltip key={tab.id}>
								<TooltipTrigger asChild>{button}</TooltipTrigger>
								{!showLabel && (
									<TooltipContent side="bottom">{label}</TooltipContent>
								)}
							</Tooltip>
						);
					})}
				</div>
			</LayoutGroup>
			<div className="drag h-full min-w-2 flex-1" />
			{actions && (
				<div className="no-drag flex shrink-0 items-center gap-0.5">
					{actions}
				</div>
			)}
			<div className="w-1 shrink-0" />
			<WindowControlsInset />
		</div>
	);
}

function formatBadgeCount(count: number): string {
	return count > 99 ? "99+" : String(count);
}
