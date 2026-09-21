import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";

interface ProgressStatProps {
	label: string;
	value: string | number;
	icon?: ReactNode;
	highlight?: boolean;
	className?: string;
}

export function ProgressStat({
	label,
	value,
	icon,
	highlight = false,
	className,
}: ProgressStatProps) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors",
				highlight
					? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
					: "bg-muted/30 border-border/40 text-muted-foreground",
				className,
			)}
		>
			{icon && <span className="shrink-0 text-sm">{icon}</span>}
			<div className="flex flex-col">
				<span className="text-[10px] uppercase tracking-wider opacity-70 font-medium">
					{label}
				</span>
				<span className="font-bold text-foreground text-xs leading-tight">
					{value}
				</span>
			</div>
		</div>
	);
}
