import type {
	OrdemElement,
	OrdemPokedexCardData,
} from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Card } from "@superset/ui/card";
import { useState } from "react";
import { HiOutlineSparkles } from "react-icons/hi2";
import { ElementBadge } from "../ElementBadge";
import { CardFoilEffect } from "./components/CardFoilEffect";

interface PokedexCardProps {
	cardData: OrdemPokedexCardData;
	onClick: () => void;
}

const ELEMENT_GLOWS: Record<OrdemElement, string> = {
	Sangue: "rgba(239, 68, 68, 0.45)",
	Morte: "rgba(163, 163, 163, 0.35)",
	Conhecimento: "rgba(245, 158, 11, 0.45)",
	Energia: "rgba(168, 85, 247, 0.45)",
	Medo: "rgba(56, 189, 248, 0.45)",
	Nenhum: "rgba(113, 113, 122, 0.3)",
};

const ELEMENT_CARD_BORDERS: Record<OrdemElement, string> = {
	Sangue: "border-red-500/40 hover:border-red-500/80",
	Morte: "border-neutral-500/40 hover:border-neutral-400/80",
	Conhecimento: "border-amber-500/40 hover:border-amber-500/80",
	Energia: "border-purple-500/40 hover:border-purple-500/80",
	Medo: "border-sky-500/40 hover:border-sky-500/80",
	Nenhum: "border-zinc-700/40 hover:border-zinc-500/80",
};

export function PokedexCard({ cardData, onClick }: PokedexCardProps) {
	const { character, pokedexEntry, isActiveNow } = cardData;
	const [imageError, setImageError] = useState(false);

	const glowColor = ELEMENT_GLOWS[character.element] ?? ELEMENT_GLOWS.Nenhum;
	const borderColor =
		ELEMENT_CARD_BORDERS[character.element] ?? ELEMENT_CARD_BORDERS.Nenhum;

	return (
		<CardFoilEffect glowColor={glowColor} className="h-full">
			<Card
				onClick={onClick}
				className={`group relative overflow-hidden bg-card/95 hover:bg-card border ${borderColor} transition-all cursor-pointer flex flex-col justify-between h-full min-h-[310px] select-none`}
			>
				{/* Top Badges & VD Header */}
				<div className="p-2.5 pb-0 flex items-center justify-between gap-1.5 z-10">
					<ElementBadge element={character.element} />

					<div className="flex items-center gap-1.5">
						{isActiveNow ? (
							<Badge
								variant="secondary"
								className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] font-medium px-2 py-0.5 gap-1 flex items-center"
							>
								<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
								Ativo
							</Badge>
						) : (
							<span className="text-[10px] font-mono font-bold text-muted-foreground uppercase px-1.5 py-0.5 bg-muted/40 rounded border border-border/40">
								VD {character.vd ?? 100}
							</span>
						)}
					</div>
				</div>

				{/* Character Portrait */}
				<div className="relative w-full h-40 mt-2 bg-zinc-950/60 overflow-hidden flex items-center justify-center border-y border-border/40">
					{!imageError ? (
						<img
							src={character.imageUrl}
							alt={character.name}
							onError={() => setImageError(true)}
							className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
							loading="lazy"
						/>
					) : (
						<div className="flex flex-col items-center justify-center text-muted-foreground gap-1.5 p-4 text-center">
							<HiOutlineSparkles className="size-8 text-primary/50" />
							<span className="text-xs font-semibold text-foreground/80">
								{character.name}
							</span>
						</div>
					)}
					<div className="absolute inset-0 bg-gradient-to-t from-background/95 via-transparent to-transparent opacity-80" />

					{/* Category overlay */}
					<div className="absolute bottom-1.5 left-2">
						<span className="text-[9px] font-bold uppercase tracking-wider text-white/90 bg-black/70 px-1.5 py-0.5 rounded border border-white/10">
							{character.category}
						</span>
					</div>
				</div>

				{/* Content & Details */}
				<div className="p-3 flex-1 flex flex-col justify-between">
					<div>
						<div className="flex items-baseline justify-between gap-1">
							<h3 className="font-extrabold text-sm text-foreground tracking-tight group-hover:text-primary transition-colors truncate">
								{character.name}
							</h3>
						</div>

						<p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
							{character.role} • {character.season}
						</p>

						<p className="text-[11px] text-muted-foreground/85 line-clamp-2 mt-2 italic leading-relaxed">
							"{character.quote || character.description}"
						</p>
					</div>

					{/* Card Footer with usage stats and dossier prompt */}
					<div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
						<span>
							Manifestações:{" "}
							<strong className="text-foreground font-mono">
								{pokedexEntry?.timesUsed ?? 1}x
							</strong>
						</span>
						<span className="text-primary font-medium group-hover:underline text-[11px]">
							Dossiê →
						</span>
					</div>
				</div>
			</Card>
		</CardFoilEffect>
	);
}
