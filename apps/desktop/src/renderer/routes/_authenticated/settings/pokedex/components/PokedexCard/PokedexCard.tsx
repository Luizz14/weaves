import type { OrdemPokedexCardData } from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Card } from "@superset/ui/card";
import { useState } from "react";
import { HiOutlineLockClosed, HiOutlineSparkles } from "react-icons/hi2";
import { ElementBadge } from "../ElementBadge";

interface PokedexCardProps {
	cardData: OrdemPokedexCardData;
	onClick: () => void;
}

export function PokedexCard({ cardData, onClick }: PokedexCardProps) {
	const { character, isDiscovered, pokedexEntry, isActiveNow } = cardData;
	const [imageError, setImageError] = useState(false);

	if (!isDiscovered) {
		return (
			<Card className="relative overflow-hidden border-border/40 bg-muted/20 hover:bg-muted/30 transition-all p-4 flex flex-col items-center justify-center text-center min-h-[260px] border-dashed select-none opacity-80 hover:opacity-100 group cursor-default">
				<div className="size-16 rounded-full bg-muted/60 border border-border/50 flex items-center justify-center mb-3 text-muted-foreground group-hover:scale-105 transition-transform">
					<HiOutlineLockClosed className="size-7" />
				</div>
				<div className="inline-block px-2 py-0.5 mb-2 text-[10px] font-mono tracking-widest uppercase bg-destructive/10 text-destructive/80 border border-destructive/20 rounded">
					CLASSIFICADO
				</div>
				<h3 className="font-semibold text-sm text-foreground/80">
					Entidade #{character.id.slice(0, 8)}
				</h3>
				<p className="text-xs text-muted-foreground mt-1 max-w-[180px]">
					Invoque este personagem criando uma nova worktree.
				</p>
			</Card>
		);
	}

	return (
		<Card
			onClick={onClick}
			className="group relative overflow-hidden border-border/60 bg-card hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer flex flex-col min-h-[280px]"
		>
			{/* Top badges & active indicator */}
			<div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10">
				<ElementBadge element={character.element} />
				{isActiveNow ? (
					<Badge
						variant="secondary"
						className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px] font-medium px-2 py-0.5 gap-1 flex items-center"
					>
						<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
						Ativo na worktree
					</Badge>
				) : (
					<Badge
						variant="secondary"
						className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0.5"
					>
						{character.category}
					</Badge>
				)}
			</div>

			{/* Character Portrait / Visual Banner */}
			<div className="relative w-full h-40 bg-muted/40 overflow-hidden flex items-center justify-center border-b border-border/40">
				{!imageError ? (
					<img
						src={character.imageUrl}
						alt={character.name}
						onError={() => setImageError(true)}
						className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
						loading="lazy"
					/>
				) : (
					<div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
						<HiOutlineSparkles className="size-8 text-primary/40" />
						<span className="text-xs font-mono">{character.name}</span>
					</div>
				)}
				<div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent opacity-80" />
			</div>

			{/* Content */}
			<div className="p-3 flex-1 flex flex-col justify-between">
				<div>
					<h3 className="font-bold text-sm text-foreground tracking-tight group-hover:text-primary transition-colors">
						{character.name}
					</h3>
					<p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
						{character.role} • {character.season}
					</p>
					<p className="text-xs text-muted-foreground/80 line-clamp-2 mt-2 italic">
						"{character.quote || character.description}"
					</p>
				</div>

				<div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
					<span>
						Usado:{" "}
						<strong className="text-foreground">
							{pokedexEntry?.timesUsed ?? 1}x
						</strong>
					</span>
					<span className="text-primary/80 group-hover:underline text-[11px]">
						Ver Dossiê →
					</span>
				</div>
			</div>
		</Card>
	);
}
