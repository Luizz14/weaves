import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/pokedex/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/pokedex", replace: true });
	},
});
