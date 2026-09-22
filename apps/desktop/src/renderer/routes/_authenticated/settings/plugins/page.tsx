import { FEATURE_FLAGS } from "@superset/shared/constants";
import { createFileRoute } from "@tanstack/react-router";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { Redirect } from "renderer/components/Redirect";
import { env } from "renderer/env.renderer";
import { PluginsView } from "renderer/routes/_authenticated/_dashboard/plugins/components/PluginsView";

export const Route = createFileRoute("/_authenticated/settings/plugins/")({
	component: PluginsSettingsPage,
});

function PluginsSettingsPage() {
	const isEnabled = useFeatureFlagEnabled(FEATURE_FLAGS.PLUGINS);
	if (env.NODE_ENV !== "development") {
		if (isEnabled === undefined) return null;
		if (!isEnabled) return <Redirect to="/v2-workspaces" replace />;
	}
	return <PluginsView />;
}
