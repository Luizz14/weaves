import type {
	OrdemCategory,
	OrdemElement,
} from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Progress } from "@superset/ui/progress";
import { HiMagnifyingGlass } from "react-icons/hi2";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface PokedexHeaderProps {
	totalCharacters: number;
	totalDiscovered: number;
	discoveryPercentage: number;
	searchQuery: string;
	onSearchChange: (q: string) => void;
	selectedElement: OrdemElement | "Todos";
	onSelectElement: (el: OrdemElement | "Todos") => void;
	selectedCategory: OrdemCategory | "Todos";
	onSelectCategory: (cat: OrdemCategory | "Todos") => void;
	onlyDiscovered: boolean;
	onToggleOnlyDiscovered: () => void;
}

const ALL_ELEMENTS: Array<OrdemElement | "Todos"> = [
	"Todos",
	"Sangue",
	"Morte",
	"Conhecimento",
	"Energia",
	"Medo",
];

const ALL_CATEGORIES: Array<{ id: OrdemCategory | "Todos"; label: string }> = [
	{ id: "Todos", label: "Todos" },
	{ id: "personagem", label: "Agentes" },
	{ id: "criatura", label: "Criaturas" },
	{ id: "reliquia", label: "Relíquias" },
];

export function PokedexHeader({
	totalCharacters,
	totalDiscovered,
	discoveryPercentage,
	searchQuery,
	onSearchChange,
	selectedElement,
	onSelectElement,
	selectedCategory,
	onSelectCategory,
	onlyDiscovered,
	onToggleOnlyDiscovered,
}: PokedexHeaderProps) {
	const triggerTest =
		electronTrpc.ordemParanormal.triggerTestReveal.useMutation();

	return (
		<div className="space-y-4 pb-4 border-b border-border/40">
			{/* Banner / Title Row */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<div className="flex items-center gap-2">
						<span className="text-xl">📜</span>
						<h1 className="text-2xl font-bold tracking-tight text-foreground">
							Arquivo Paranormal • Ordo Realitas
						</h1>
					</div>
					<p className="text-xs text-muted-foreground mt-1">
						Catálogo global e permanente de entidades e investigadores
						manifestados em suas worktrees.
					</p>
				</div>

				<div className="flex items-center gap-3">
					<Button
						variant="outline"
						size="sm"
						onClick={() => triggerTest.mutate({})}
						disabled={triggerTest.isPending}
						className="h-8 text-xs gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
					>
						✨ Testar Carta Pokémon
					</Button>

					{/* Progress Counter */}
					<div className="flex flex-col items-end min-w-[200px] bg-muted/30 p-3 rounded-lg border border-border/40">
						<div className="flex items-center justify-between w-full text-xs mb-1.5">
							<span className="text-muted-foreground font-medium">
								Progresso de Descoberta
							</span>
							<span className="font-bold text-foreground">
								{totalDiscovered} / {totalCharacters} ({discoveryPercentage}%)
							</span>
						</div>
						<Progress value={discoveryPercentage} className="h-2 w-full" />
					</div>
				</div>
			</div>

			{/* Filters Row */}
			<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pt-2">
				{/* Search bar */}
				<div className="relative w-full md:w-72">
					<HiMagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
					<Input
						placeholder="Buscar por nome, cargo, temporada..."
						value={searchQuery}
						onChange={(e) => onSearchChange(e.target.value)}
						className="pl-8 h-9 text-xs"
					/>
				</div>

				{/* Category & Status Filter Pills */}
				<div className="flex flex-wrap items-center gap-1.5">
					{ALL_CATEGORIES.map((cat) => (
						<button
							key={cat.id}
							type="button"
							onClick={() => onSelectCategory(cat.id)}
							className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
								selectedCategory === cat.id
									? "bg-primary text-primary-foreground border-primary font-medium"
									: "bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground"
							}`}
						>
							{cat.label}
						</button>
					))}

					<button
						type="button"
						onClick={onToggleOnlyDiscovered}
						className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
							onlyDiscovered
								? "bg-amber-500/20 text-amber-400 border-amber-500/40 font-medium"
								: "bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground"
						}`}
					>
						{onlyDiscovered ? "✓ Apenas Descobertos" : "Todos os Status"}
					</button>
				</div>
			</div>

			{/* Elements Filter row */}
			<div className="flex flex-wrap items-center gap-1 text-xs">
				<span className="text-muted-foreground text-[11px] mr-1.5 font-medium">
					Elemento:
				</span>
				{ALL_ELEMENTS.map((elem) => (
					<Badge
						key={elem}
						variant="outline"
						onClick={() => onSelectElement(elem)}
						className={`cursor-pointer transition-all text-[11px] px-2 py-0.5 ${
							selectedElement === elem
								? "bg-accent text-accent-foreground border-foreground/40 font-semibold"
								: "bg-transparent text-muted-foreground hover:text-foreground border-border/40"
						}`}
					>
						{elem}
					</Badge>
				))}
			</div>
		</div>
	);
}
