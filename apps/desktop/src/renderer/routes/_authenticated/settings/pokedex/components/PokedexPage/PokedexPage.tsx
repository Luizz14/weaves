import type {
	OrdemCategory,
	OrdemElement,
	OrdemPokedexCardData,
} from "@superset/shared/ordem-paranormal";
import { Spinner } from "@superset/ui/spinner";
import { useMemo, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { PokedexCard } from "../PokedexCard";
import { PokedexDetailModal } from "../PokedexDetailModal";
import { PokedexHeader } from "../PokedexHeader";

export function PokedexPage() {
	const {
		data: summary,
		isLoading,
		error,
	} = electronTrpc.ordemParanormal.getSummary.useQuery(undefined, {
		refetchInterval: 10_000, // Keep active worktree status fresh
	});

	const [searchQuery, setSearchQuery] = useState("");
	const [selectedElement, setSelectedElement] = useState<
		OrdemElement | "Todos"
	>("Todos");
	const [selectedCategory, setSelectedCategory] = useState<
		OrdemCategory | "Todos"
	>("Todos");
	const [onlyDiscovered, setOnlyDiscovered] = useState(false);
	const [selectedCard, setSelectedCard] = useState<OrdemPokedexCardData | null>(
		null,
	);

	const filteredCards = useMemo(() => {
		if (!summary?.cards) return [];

		return summary.cards.filter((card) => {
			const { character, isDiscovered } = card;

			if (onlyDiscovered && !isDiscovered) {
				return false;
			}

			if (
				selectedElement !== "Todos" &&
				character.element !== selectedElement
			) {
				return false;
			}

			if (
				selectedCategory !== "Todos" &&
				character.category !== selectedCategory
			) {
				return false;
			}

			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase().trim();
				// If not discovered, don't match full name or description to prevent spoilers unless matching generic id
				if (!isDiscovered) {
					return character.id.toLowerCase().includes(q);
				}

				const matchesName = character.name.toLowerCase().includes(q);
				const matchesRole = character.role.toLowerCase().includes(q);
				const matchesSeason = character.season.toLowerCase().includes(q);
				const matchesDesc = character.description.toLowerCase().includes(q);
				return matchesName || matchesRole || matchesSeason || matchesDesc;
			}

			return true;
		});
	}, [
		summary?.cards,
		onlyDiscovered,
		selectedElement,
		selectedCategory,
		searchQuery,
	]);

	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
				<Spinner className="size-6" />
				<p className="text-xs">
					Acessando os arquivos confidenciais da Ordo Realitas...
				</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[400px] gap-2 text-destructive">
				<p className="font-semibold text-sm">
					Falha ao carregar o Arquivo Paranormal
				</p>
				<p className="text-xs text-muted-foreground">{error.message}</p>
			</div>
		);
	}

	const totalCharacters = summary?.totalCharacters ?? 0;
	const totalDiscovered = summary?.totalDiscovered ?? 0;
	const discoveryPercentage = summary?.discoveryPercentage ?? 0;

	return (
		<div className="flex-1 w-full max-w-7xl mx-auto p-6 space-y-6">
			<PokedexHeader
				totalCharacters={totalCharacters}
				totalDiscovered={totalDiscovered}
				discoveryPercentage={discoveryPercentage}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
				selectedElement={selectedElement}
				onSelectElement={setSelectedElement}
				selectedCategory={selectedCategory}
				onSelectCategory={setSelectedCategory}
				onlyDiscovered={onlyDiscovered}
				onToggleOnlyDiscovered={() => setOnlyDiscovered(!onlyDiscovered)}
			/>

			{/* Cards Grid */}
			{filteredCards.length === 0 ? (
				<div className="text-center py-16 text-muted-foreground bg-muted/10 rounded-xl border border-dashed border-border/60">
					<p className="text-sm font-medium">
						Nenhum registro paranormal encontrado com estes filtros.
					</p>
					<p className="text-xs mt-1">
						Tente ajustar a busca ou desativar os filtros.
					</p>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
					{filteredCards.map((card) => (
						<PokedexCard
							key={card.character.id}
							cardData={card}
							onClick={() => card.isDiscovered && setSelectedCard(card)}
						/>
					))}
				</div>
			)}

			{/* Detail Modal */}
			<PokedexDetailModal
				cardData={selectedCard}
				isOpen={!!selectedCard}
				onClose={() => setSelectedCard(null)}
			/>
		</div>
	);
}
