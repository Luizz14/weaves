import type { OrdemPokedexCardData } from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@superset/ui/dialog";
import { ScrollArea } from "@superset/ui/scroll-area";
import { useState } from "react";
import {
	HiOutlineClock,
	HiOutlineFolder,
	HiOutlineSparkles,
} from "react-icons/hi2";
import { LuGitBranch } from "react-icons/lu";
import { ElementBadge } from "../ElementBadge";

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

	const formatDate = (isoString?: string) => {
		if (!isoString) return "Desconhecido";
		try {
			return new Date(isoString).toLocaleString("pt-BR", {
				dateStyle: "medium",
				timeStyle: "short",
			});
		} catch {
			return isoString;
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col gap-0 border-border/70">
				{/* Top Portrait Header */}
				<div className="relative w-full h-56 bg-muted/40 overflow-hidden flex items-center justify-center border-b border-border/40">
					{!imageError ? (
						<img
							src={character.imageUrl}
							alt={character.name}
							onError={() => setImageError(true)}
							className="w-full h-full object-cover object-top"
						/>
					) : (
						<div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
							<HiOutlineSparkles className="size-12 text-primary/40" />
							<span className="text-sm font-mono">{character.name}</span>
						</div>
					)}
					<div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

					<div className="absolute bottom-4 left-6 right-6 flex items-end justify-between">
						<div>
							<div className="flex items-center gap-2 mb-1.5">
								<ElementBadge element={character.element} />
								<Badge
									variant="secondary"
									className="text-xs uppercase tracking-wider"
								>
									{character.category}
								</Badge>
								{isActiveNow && (
									<Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs">
										● Ativo no momento
									</Badge>
								)}
							</div>
							<DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
								{character.name}
							</DialogTitle>
							<p className="text-xs text-muted-foreground">
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
											className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md font-mono"
										>
											{branch}
										</code>
									))}
								</div>
							</div>
						)}

						{/* History & Statistics */}
						<div>
							<h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
								<HiOutlineClock className="size-3.5" />
								Histórico de Manifestação
							</h4>

							<div className="grid grid-cols-2 gap-3 mb-3 text-xs">
								<div className="bg-muted/20 p-2.5 rounded border border-border/40">
									<div className="text-muted-foreground text-[11px]">
										Total de Invocação
									</div>
									<div className="font-bold text-sm text-foreground mt-0.5">
										{pokedexEntry?.timesUsed ?? 1}x
									</div>
								</div>
								<div className="bg-muted/20 p-2.5 rounded border border-border/40">
									<div className="text-muted-foreground text-[11px]">
										Primeira Aparição
									</div>
									<div className="font-medium text-foreground mt-0.5">
										{formatDate(pokedexEntry?.firstDiscoveredAt)}
									</div>
								</div>
							</div>

							{pokedexEntry?.appearances &&
								pokedexEntry.appearances.length > 0 && (
									<div className="space-y-1.5">
										<div className="text-[11px] font-medium text-muted-foreground">
											Últimas worktrees registradas:
										</div>
										<div className="divide-y divide-border/30 border border-border/40 rounded-md overflow-hidden bg-muted/10 text-xs">
											{pokedexEntry.appearances.map((app, idx) => (
												<div
													key={`${app.branch}-${app.discoveredAt}-${idx}`}
													className="p-2 flex items-center justify-between gap-2"
												>
													<div className="flex items-center gap-2 truncate">
														<LuGitBranch className="size-3 text-muted-foreground shrink-0" />
														<span className="font-mono text-[11px] text-foreground truncate">
															{app.branch}
														</span>
														{app.project && (
															<span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0 flex items-center gap-1">
																<HiOutlineFolder className="size-2.5" />
																{app.project}
															</span>
														)}
													</div>
													<span className="text-[10px] text-muted-foreground shrink-0">
														{formatDate(app.discoveredAt)}
													</span>
												</div>
											))}
										</div>
									</div>
								)}
						</div>
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
