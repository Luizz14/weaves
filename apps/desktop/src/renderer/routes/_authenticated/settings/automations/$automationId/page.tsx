import { createFileRoute } from "@tanstack/react-router";
import { AutomationDetailPageContent } from "renderer/routes/_authenticated/_dashboard/automations/$automationId/page";

export const Route = createFileRoute(
	"/_authenticated/settings/automations/$automationId/",
)({
	component: AutomationDetailSettingsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		history: search.history === true,
	}),
});

function AutomationDetailSettingsPage() {
	const { automationId } = Route.useParams();
	const { history } = Route.useSearch();
	return (
		<AutomationDetailPageContent
			automationId={automationId}
			history={history}
		/>
	);
}
