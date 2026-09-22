import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPageContent } from "renderer/routes/_authenticated/_dashboard/automations/page";

export const Route = createFileRoute("/_authenticated/settings/automations/")({
	component: AutomationsSettingsPage,
});

function AutomationsSettingsPage() {
	return <AutomationsPageContent />;
}
