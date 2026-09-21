import type { OrdemCharacterAppearance } from "@superset/shared/ordem-paranormal";
import { HiOutlineClock, HiOutlineFolder } from "react-icons/hi2";
import { LuGitBranch } from "react-icons/lu";

interface DossierTimelineProps {
	appearances?: OrdemCharacterAppearance[];
	timesUsed?: number;
	firstDiscoveredAt?: string;
}

export function DossierTimeline({
	appearances = [],
	timesUsed = 1,
	firstDiscoveredAt,
}: DossierTimelineProps) {
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
		<div className="space-y-3">
			<h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
				<HiOutlineClock className="size-3.5" />
				Histórico de Manifestação na Máquina
			</h4>

			{/* Stat cards */}
			<div className="grid grid-cols-2 gap-3 text-xs">
				<div className="bg-muted/20 p-2.5 rounded-lg border border-border/40">
					<div className="text-muted-foreground text-[11px]">
						Total de Invocações
					</div>
					<div className="font-mono font-bold text-sm text-foreground mt-0.5">
						{timesUsed}x
					</div>
				</div>

				<div className="bg-muted/20 p-2.5 rounded-lg border border-border/40">
					<div className="text-muted-foreground text-[11px]">
						Primeira Descoberta
					</div>
					<div className="font-medium text-foreground text-xs mt-0.5 truncate">
						{formatDate(firstDiscoveredAt)}
					</div>
				</div>
			</div>

			{/* Appearances list */}
			{appearances.length > 0 ? (
				<div className="space-y-1.5">
					<div className="text-[11px] font-medium text-muted-foreground">
						Últimas worktrees vinculadas:
					</div>
					<div className="divide-y divide-border/30 border border-border/40 rounded-lg overflow-hidden bg-muted/10 text-xs">
						{appearances.map((app, idx) => (
							<div
								key={`${app.branch}-${app.discoveredAt}-${idx}`}
								className="p-2.5 flex items-center justify-between gap-2 hover:bg-muted/20 transition-colors"
							>
								<div className="flex items-center gap-2 truncate">
									<LuGitBranch className="size-3.5 text-muted-foreground shrink-0" />
									<span className="font-mono text-xs text-foreground truncate font-medium">
										{app.branch}
									</span>
									{app.project && (
										<span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded text-muted-foreground shrink-0 flex items-center gap-1 border border-border/30">
											<HiOutlineFolder className="size-2.5" />
											{app.project}
										</span>
									)}
								</div>
								<span className="text-[11px] text-muted-foreground font-mono shrink-0">
									{formatDate(app.discoveredAt)}
								</span>
							</div>
						))}
					</div>
				</div>
			) : (
				<p className="text-xs text-muted-foreground italic">
					Nenhuma worktree registrada detalhadamente.
				</p>
			)}
		</div>
	);
}
