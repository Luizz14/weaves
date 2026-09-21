import type {
	OrdemCategory,
	OrdemElement,
} from "@superset/shared/ordem-paranormal";
import { Badge } from "@superset/ui/badge";
import { Input } from "@superset/ui/input";
import { HiMagnifyingGlass } from "react-icons/hi2";

interface PokedexFilterBarProps {
	searchQuery: string;
	onSearchChange: (q: string) => void;
	selectedCategory: OrdemCategory | "Todos";
	onSelectCategory: (cat: OrdemCategory | "Todos") => void;
	selectedElement: OrdemElement | "Todos";
	onSelectElement: (el: OrdemElement | "Todos") => void;
	onlyDiscovered: boolean;
	onToggleOnlyDiscovered: () => void;
}

const ALL_CATEGORIES: Array<{ id: OrdemCategory | "Todos"; label: string }> = [
	{ id: "Todos", label: "Todos" },
	{ id: "personagem", label: "Agentes" },
	{ id: "criatura", label: "Criaturas" },
	{ id: "reliquia", label: "Relíquias" },
];

const ALL_ELEMENTS: Array<OrdemElement | "Todos"> = [
	"Todos",
	"Sangue",
	"Morte",
	"Conhecimento",
	"Energia",
	"Medo",
];

const ELEMENT_COLORS: Record<string, string> = {
	Sangue: "hover:border-red-500/50 hover:text-red-400",
	Morte: "hover:border-neutral-400/50 hover:text-neutral-300",
	Conhecimento: "hover:border-amber-500/50 hover:text-amber-400",
	Energia: "hover:border-purple-500/50 hover:text-purple-400",
	Medo: "hover:border-sky-500/50 hover:text-sky-400",
	Todos: "hover:border-primary/50 hover:text-foreground",
};

export function PokedexFilterBar({
	searchQuery,
	onSearchChange,
	selectedCategory,
	onSelectCategory,
	selectedElement,
	onSelectElement,
	onlyDiscovered,
	onToggleOnlyDiscovered,
}: PokedexFilterBarProps) {
	return (
		<div className="flex flex-col gap-3 py-2">
			{/* Upper Filter Bar: Search + Categories + Only Discovered */}
			<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
				{/* Search bar */}
				<div className="relative w-full md:w-80">
					<HiMagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
					<Input
						placeholder="Buscar por nome, cargo, temporada..."
						value={searchQuery}
						onChange={(e) => onSearchChange(e.target.value)}
						className="pl-8 h-9 text-xs bg-muted/20 border-border/50 focus-visible:ring-1"
					/>
				</div>

				{/* Category & Status Filter Pills */}
				<div className="flex flex-wrap items-center gap-1.5">
					{ALL_CATEGORIES.map((cat) => (
						<button
							key={cat.id}
							type="button"
							onClick={() => onSelectCategory(cat.id)}
							className={`text-xs px-3 py-1 rounded-md border transition-all cursor-pointer ${
								selectedCategory === cat.id
									? "bg-primary text-primary-foreground border-primary font-semibold shadow-xs"
									: "bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/60"
							}`}
						>
							{cat.label}
						</button>
					))}

					<div className="w-[1px] h-5 bg-border/60 mx-1 hidden sm:block" />

					<button
						type="button"
						onClick={onToggleOnlyDiscovered}
						className={`text-xs px-3 py-1 rounded-md border transition-all cursor-pointer ${
							onlyDiscovered
								? "bg-amber-500/20 text-amber-400 border-amber-500/40 font-semibold shadow-xs"
								: "bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/60"
						}`}
					>
						{onlyDiscovered ? "✓ Descobertos" : "Todos os Status"}
					</button>
				</div>
			</div>

			{/* Elements Filter Chips */}
			<div className="flex flex-wrap items-center gap-1.5 pt-1">
				<span className="text-muted-foreground text-[11px] mr-1 font-medium">
					Elemento Paranormal:
				</span>
				{ALL_ELEMENTS.map((elem) => {
					const isSelected = selectedElement === elem;
					const hoverColor = ELEMENT_COLORS[elem] ?? "";

					return (
						<Badge
							key={elem}
							variant="outline"
							onClick={() => onSelectElement(elem)}
							className={`cursor-pointer transition-all text-[11px] px-2.5 py-0.5 select-none ${
								isSelected
									? "bg-accent text-accent-foreground border-foreground/40 font-bold shadow-xs scale-105"
									: `bg-muted/20 text-muted-foreground border-border/40 ${hoverColor}`
							}`}
						>
							{elem}
						</Badge>
					);
				})}
			</div>
		</div>
	);
}
