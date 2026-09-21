import { createFileRoute } from "@tanstack/react-router";
import { PokedexPage } from "./components/PokedexPage";

export const Route = createFileRoute("/_authenticated/settings/pokedex/")({
	component: PokedexPage,
});
