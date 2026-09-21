import type { OrdemElement } from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { cn } from "@superset/ui/utils";

interface ElementBadgeProps {
	element: OrdemElement;
	className?: string;
}

const ELEMENT_STYLES: Record<
	OrdemElement,
	{ label: string; icon: string; className: string }
> = {
	Sangue: {
		label: "Sangue",
		icon: "🩸",
		className: "bg-red-500/10 text-red-500 border-red-500/30",
	},
	Morte: {
		label: "Morte",
		icon: "⏳",
		className: "bg-neutral-500/10 text-neutral-300 border-neutral-600/40",
	},
	Conhecimento: {
		label: "Conhecimento",
		icon: "📜",
		className: "bg-amber-500/10 text-amber-400 border-amber-500/30",
	},
	Energia: {
		label: "Energia",
		icon: "⚡",
		className: "bg-purple-500/10 text-purple-400 border-purple-500/30",
	},
	Medo: {
		label: "Medo",
		icon: "👁️",
		className: "bg-sky-500/10 text-sky-400 border-sky-500/30",
	},
	Nenhum: {
		label: "Neutro",
		icon: "⚪",
		className: "bg-zinc-500/10 text-zinc-400 border-zinc-700/30",
	},
};

export function ElementBadge({ element, className }: ElementBadgeProps) {
	const info = ELEMENT_STYLES[element] ?? ELEMENT_STYLES.Nenhum;

	return (
		<Badge
			variant="outline"
			className={cn(
				"px-2 py-0.5 text-xs font-medium gap-1 flex items-center shadow-none",
				info.className,
				className,
			)}
		>
			<span className="text-[10px] leading-none">{info.icon}</span>
			<span>{info.label}</span>
		</Badge>
	);
}
