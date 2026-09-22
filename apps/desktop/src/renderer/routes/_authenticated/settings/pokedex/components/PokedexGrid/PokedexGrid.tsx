import type { OrdemPokedexCardData } from "@superset/shared/ordem-paranormal";
import { PokedexCard } from "../PokedexCard";
import { PokedexConfidentialCard } from "../PokedexConfidentialCard";

interface PokedexGridProps {
	cards: OrdemPokedexCardData[];
	onSelectCard: (card: OrdemPokedexCardData) => void;
}

export function PokedexGrid({ cards, onSelectCard }: PokedexGridProps) {
	if (cards.length === 0) {
		return (
			<div className="text-center py-20 px-4 text-muted-foreground bg-muted/10 rounded-2xl border border-dashed border-border/60 flex flex-col items-center justify-center">
				<div className="size-12 rounded-full bg-muted/40 flex items-center justify-center mb-3 text-2xl select-none">
					🔍
				</div>
				<p className="text-sm font-semibold text-foreground/80">
					Nenhum registro paranormal encontrado
				</p>
				<p className="text-xs text-muted-foreground mt-1 max-w-sm">
					Nenhuma entidade ou agente corresponde aos filtros atuais. Tente
					buscar por outro termo ou redefinir os elementos.
				</p>
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4.5">
			{cards.map((card) =>
				card.isDiscovered ? (
					<PokedexCard
						key={card.character.id}
						cardData={card}
						onClick={() => onSelectCard(card)}
					/>
				) : (
					<PokedexConfidentialCard key={card.character.id} cardData={card} />
				),
			)}
		</div>
	);
}
