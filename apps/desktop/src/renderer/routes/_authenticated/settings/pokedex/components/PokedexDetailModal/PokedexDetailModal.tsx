import type { OrdemPokedexCardData } from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@superset/ui/dialog";
import { ScrollArea } from "@superset/ui/scroll-area";
import { useState } from "react";
import { HiOutlineSparkles } from "react-icons/hi2";
import { LuGitBranch } from "react-icons/lu";
import { ElementBadge } from "../ElementBadge";
import { DossierTimeline } from "./components/DossierTimeline";

interface PokedexDetailModalProps {
	cardData: OrdemPokedexCardData | null;
	isOpen: boolean;
	onClose: () => void;
}

export function PokedexDetailModal({
	cardData,
	isOpen,
	onClose,
}: PokedexDetailModalProps) {
	const [imageError, setImageError] = useState(false);

	if (!cardData) return null;

	const { character, pokedexEntry, isActiveNow, activeBranches } = cardData;

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col gap-0 border-border/70 bg-background/95 backdrop-blur-md">
				{/* Top Portrait Header */}
				<div className="relative w-full h-56 bg-zinc-950 overflow-hidden flex items-center justify-center border-b border-border/40">
					{!imageError ? (
						<img
							src={character.imageUrl}
							alt={character.name}
							onError={() => setImageError(true)}
							className="w-full h-full object-cover object-top"
						/>
					) : (
						<div className="flex flex-col items-center justify-center text-muted-foreground gap-2">
							<HiOutlineSparkles className="size-12 text-primary/50" />
							<span className="text-sm font-mono font-bold">
								{character.name}
							</span>
						</div>
					)}
					<div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

					<div className="absolute bottom-4 left-6 right-6 flex items-end justify-between">
						<div>
							<div className="flex items-center gap-2 mb-1.5 flex-wrap">
								<ElementBadge element={character.element} />
								<span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/40">
									VD {character.vd ?? 100}
								</span>
								<Badge
									variant="secondary"
									className="text-xs uppercase tracking-wider bg-muted/60"
								>
									{character.category}
								</Badge>
								{isActiveNow && (
									<Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs">
										● Ativo no momento
									</Badge>
								)}
							</div>
							<DialogTitle className="text-2xl font-black tracking-tight text-foreground">
								{character.name}
							</DialogTitle>
							<DialogDescription className="sr-only">
								Dossiê confidencial da Ordo Realitas sobre {character.name}
							</DialogDescription>
							<p className="text-xs text-muted-foreground mt-0.5">
								{character.role} • {character.season}
							</p>
						</div>
					</div>
				</div>

				{/* Scrollable Details Body */}
				<ScrollArea className="flex-1 p-6 max-h-[calc(85vh-14rem)]">
					<div className="space-y-6">
						{/* Quote */}
						{character.quote && (
							<blockquote className="p-3 bg-muted/30 border-l-2 border-primary rounded-r-md italic text-sm text-foreground/90">
								"{character.quote}"
							</blockquote>
						)}

						{/* Lore Description */}
						<div>
							<h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
								Dossiê da Ordem
							</h4>
							<p className="text-sm leading-relaxed text-foreground/90">
								{character.description}
							</p>
						</div>

						{/* Active Worktree Branches */}
						{activeBranches.length > 0 && (
							<div>
								<h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-500 mb-2 flex items-center gap-1.5">
									<LuGitBranch className="size-3.5" />
									Branches / Worktrees Ativas Agora
								</h4>
								<div className="flex flex-wrap gap-1.5">
									{activeBranches.map((branch) => (
										<code
											key={branch}
											className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md font-mono font-medium"
										>
											{branch}
										</code>
									))}
								</div>
							</div>
						)}

						{/* History & Statistics using DossierTimeline */}
						<DossierTimeline
							appearances={pokedexEntry?.appearances}
							timesUsed={pokedexEntry?.timesUsed ?? 1}
							firstDiscoveredAt={pokedexEntry?.firstDiscoveredAt}
						/>
					</div>
				</ScrollArea>

				{/* Footer */}
				<div className="p-3 border-t border-border/40 flex justify-end bg-muted/10">
					<Button variant="outline" size="sm" onClick={onClose}>
						Fechar
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
