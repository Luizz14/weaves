import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPageContent } from "./components/AutomationsPageContent";

export const Route = createFileRoute("/_authenticated/settings/automations/")({
	component: AutomationsSettingsPage,
});

function AutomationsSettingsPage() {
	return <AutomationsPageContent />;
}
