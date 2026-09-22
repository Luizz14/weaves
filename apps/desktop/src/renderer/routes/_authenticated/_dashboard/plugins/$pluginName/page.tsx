import { createFileRoute } from "@tanstack/react-router";
import { Redirect } from "renderer/components/Redirect";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/plugins/$pluginName/",
)({
	component: LegacyPluginDetailRedirect,
	validateSearch: (search: Record<string, unknown>) => ({
		connected:
			typeof search.connected === "string" ? search.connected : undefined,
		error: typeof search.error === "string" ? search.error : undefined,
	}),
});

function LegacyPluginDetailRedirect() {
	const { pluginName } = Route.useParams();
	const search = Route.useSearch();
	return (
		<Redirect
			to="/settings/plugins/$pluginName"
			params={{ pluginName }}
			search={search}
			replace
		/>
	);
}
