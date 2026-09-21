import { Button } from "@superset/ui/button";
import { Progress } from "@superset/ui/progress";
import { HiOutlineSparkles } from "react-icons/hi2";
import { LuGitBranch } from "react-icons/lu";
import { ProgressStat } from "./components/ProgressStat";

interface PokedexHeaderProps {
	totalCharacters: number;
	totalDiscovered: number;
	discoveryPercentage: number;
	activeWorktreesCount?: number;
	onTriggerTest?: () => void;
	isTriggerPending?: boolean;
}

export function PokedexHeader({
	totalCharacters,
	totalDiscovered,
	discoveryPercentage,
	activeWorktreesCount = 0,
	onTriggerTest,
	isTriggerPending = false,
}: PokedexHeaderProps) {
	return (
		<div className="space-y-4 pb-4 border-b border-border/40">
			{/* Top Banner Row */}
			<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
				<div>
					<div className="flex items-center gap-2.5">
						<span className="text-2xl select-none">📜</span>
						<div>
							<div className="flex items-center gap-2">
								<h1 className="text-2xl font-black tracking-tight text-foreground">
									Arquivo Paranormal
								</h1>
								<span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-800/40">
									Ordo Realitas
								</span>
							</div>
							<p className="text-xs text-muted-foreground mt-0.5">
								Catálogo sigiloso de agentes, criaturas e relíquias manifestados
								em suas worktrees locais.
							</p>
						</div>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2.5">
					{/* Test Pokémon Card Button */}
					{onTriggerTest && (
						<Button
							variant="outline"
							size="sm"
							onClick={onTriggerTest}
							disabled={isTriggerPending}
							className="h-9 text-xs gap-1.5 border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/40"
						>
							<HiOutlineSparkles className="size-3.5 text-amber-400" />
							Testar Carta Pokémon
						</Button>
					)}

					{/* Active Worktrees Stat */}
					<ProgressStat
						label="Worktrees Ativas"
						value={activeWorktreesCount}
						icon={<LuGitBranch className="size-3.5" />}
						highlight={activeWorktreesCount > 0}
					/>

					{/* Discovered Stat */}
					<ProgressStat
						label="Manifestados"
						value={`${totalDiscovered} / ${totalCharacters}`}
						icon={<span className="text-xs">👁️</span>}
					/>
				</div>
			</div>

			{/* Progress Bar Row */}
			<div className="bg-muted/20 p-3 rounded-lg border border-border/40 flex flex-col gap-1.5">
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground font-medium flex items-center gap-1.5">
						<span>Índice de Investigação da Realidade</span>
						<span className="text-[10px] text-muted-foreground/60 font-mono">
							(Sincronização com o Outro Lado)
						</span>
					</span>
					<span className="font-bold text-foreground font-mono">
						{discoveryPercentage}% Concluído
					</span>
				</div>
				<Progress
					value={discoveryPercentage}
					className="h-2 w-full bg-muted/60"
				/>
			</div>
		</div>
	);
}
