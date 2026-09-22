import { createFileRoute } from "@tanstack/react-router";
import { AiSettings } from "./components/AiSettings";

export const Route = createFileRoute("/_authenticated/settings/ai/")({
	component: AiSettingsPage,
	validateSearch: (search: Record<string, unknown>): { hostId?: string } => ({
		hostId: typeof search.hostId === "string" ? search.hostId : undefined,
	}),
});

function AiSettingsPage() {
	const { hostId } = Route.useSearch();
	return <AiSettings hostId={hostId ?? null} />;
}
