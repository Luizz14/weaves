import { useLingui } from "@lingui/react/macro";
import { FEATURE_FLAGS } from "@superset/shared/constants";
import { toast } from "@superset/ui/sonner";
import { createFileRoute } from "@tanstack/react-router";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { useEffect } from "react";
import { Redirect } from "renderer/components/Redirect";
import { env } from "renderer/env.renderer";
import { PluginDetail } from "renderer/routes/_authenticated/_dashboard/plugins/$pluginName/components/PluginDetail";
import { usePluginCatalog } from "renderer/routes/_authenticated/_dashboard/plugins/hooks/usePluginCatalog";

export type PluginDetailSearch = {
	connected?: string;
	error?: string;
};

export const Route = createFileRoute(
	"/_authenticated/settings/plugins/$pluginName/",
)({
	component: PluginDetailSettingsPage,
	validateSearch: (search: Record<string, unknown>): PluginDetailSearch => ({
		connected:
			typeof search.connected === "string" ? search.connected : undefined,
		error: typeof search.error === "string" ? search.error : undefined,
	}),
});

function PluginDetailSettingsPage() {
	const { pluginName } = Route.useParams();
	const plugin = pluginName;
	const { connected, error } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { t } = useLingui();
	const isEnabled = useFeatureFlagEnabled(FEATURE_FLAGS.PLUGINS);
	const { plugins, isLoading } = usePluginCatalog();
	const pluginEntry = plugins.find((entry) => entry.name === pluginName);

	useEffect(() => {
		if (connected === undefined && !error) return;
		if (connected !== undefined) {
			const label = connected || plugin;
			toast.success(t({ message: `Connected ${label}` }));
		} else if (error === "oauth_denied") {
			toast.error(
				t({ message: `You declined the ${plugin} authorization request.` }),
			);
		} else if (error === "not_installed") {
			toast.error(t({ message: `${plugin} is no longer installed.` }));
		} else if (error === "invalid_state") {
			toast.error(
				t({
					message: `That ${plugin} sign-in link expired. Try connecting again.`,
				}),
			);
		} else if (error === "client_unconfigured") {
			toast.error(
				t({
					message: `${plugin} has no OAuth client configured on this deployment yet.`,
				}),
			);
		} else {
			toast.error(t({ message: `Could not connect ${plugin}. Try again.` }));
		}
		void navigate({ search: {}, replace: true });
	}, [connected, error, navigate, plugin, t]);

	if (env.NODE_ENV !== "development") {
		if (isEnabled === undefined) return null;
		if (!isEnabled) return <Redirect to="/v2-workspaces" replace />;
	}
	if (isLoading) return null;
	if (!pluginEntry) return <Redirect to="/settings/plugins" replace />;
	return <PluginDetail plugin={pluginEntry} />;
}
