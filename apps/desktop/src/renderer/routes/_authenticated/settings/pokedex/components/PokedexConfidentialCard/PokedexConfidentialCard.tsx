import type { OrdemPokedexCardData } from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Card } from "@superset/ui/card";
import { HiOutlineLockClosed } from "react-icons/hi2";
import { ElementBadge } from "../ElementBadge";

interface PokedexConfidentialCardProps {
	cardData: OrdemPokedexCardData;
}

export function PokedexConfidentialCard({
	cardData,
}: PokedexConfidentialCardProps) {
	const { character } = cardData;

	return (
		<Card className="relative overflow-hidden border-border/40 bg-zinc-950/40 hover:bg-zinc-900/40 transition-all p-4 flex flex-col justify-between min-h-[300px] border-dashed select-none group">
			{/* Top Header Tag: Redacted / Confidential Badge */}
			<div className="flex items-center justify-between gap-2 z-10">
				<ElementBadge element={character.element} className="opacity-60" />
				<Badge
					variant="outline"
					className="px-2 py-0.5 text-[9px] font-mono font-bold tracking-widest uppercase bg-red-500/10 text-red-400 border-red-500/30"
				>
					[CLASSIFICADO]
				</Badge>
			</div>

			{/* Center Silhouette & Confidential Seal */}
			<div className="flex flex-col items-center justify-center my-4">
				<div className="relative size-20 rounded-full bg-zinc-900/80 border border-zinc-700/50 flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 group-hover:scale-105 transition-all shadow-inner">
					<HiOutlineLockClosed className="size-8" />
					<div className="absolute inset-0 rounded-full bg-radial from-white/5 to-transparent pointer-events-none" />
				</div>
				<div className="mt-2.5 font-mono text-[11px] text-zinc-400 tracking-wider">
					ARQUIVO #{character.id.toUpperCase()}
				</div>
			</div>

			{/* Teaser & Hint Section */}
			<div className="space-y-2 border-t border-border/30 pt-3">
				<p className="text-[11px] text-muted-foreground/80 italic line-clamp-2 leading-relaxed text-center">
					{character.teaser ||
						"Manifestação paranormal selada sob custódia da Ordo Realitas."}
				</p>

				{/* Unlock Instruction Bar */}
				<div className="bg-zinc-900/50 border border-zinc-800 rounded px-2 py-1 text-center">
					<span className="text-[10px] text-zinc-400 font-mono">
						Criar worktree para manifestar
					</span>
				</div>
			</div>
		</Card>
	);
}
