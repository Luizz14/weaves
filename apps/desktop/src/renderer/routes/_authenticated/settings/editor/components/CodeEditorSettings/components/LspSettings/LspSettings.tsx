import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import {
	LSP_SERVER_IDS,
	type LspServerId,
	type LspServerSettings,
} from "@superset/shared/lsp";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { LspServerCard } from "./components/LspServerCard";

export function LspSettings() {
	const { t } = useLingui();
	const hostUrl = useHostUrl(null);
	const queryClient = useQueryClient();
	const client = hostUrl ? getHostServiceClientByUrl(hostUrl) : null;
	const settings = useQuery({
		queryKey: ["lsp-settings", hostUrl],
		enabled: !!client,
		queryFn: () => {
			if (!client) throw new Error("Host unavailable");
			return client.settings.lsp.get.query();
		},
	});
	const availability = useQuery({
		queryKey: ["lsp-availability", hostUrl],
		enabled: !!client,
		queryFn: () => {
			if (!client) throw new Error("Host unavailable");
			return client.lsp.availability.query();
		},
	});
	const status = useQuery({
		queryKey: ["lsp-status", hostUrl],
		enabled: !!client,
		refetchInterval: 5000,
		queryFn: () => {
			if (!client) throw new Error("Host unavailable");
			return client.lsp.status.query();
		},
	});
	const save = useMutation({
		mutationFn: ({
			serverId,
			value,
		}: {
			serverId: LspServerId;
			value: LspServerSettings;
		}) => {
			if (!client || !settings.data) throw new Error("Host unavailable");
			return client.settings.lsp.set.mutate({
				servers: { ...settings.data.servers, [serverId]: value },
			});
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["lsp-settings", hostUrl] }),
				queryClient.invalidateQueries({
					queryKey: ["lsp-availability", hostUrl],
				}),
				queryClient.invalidateQueries({ queryKey: ["lsp-status", hostUrl] }),
			]);
		},
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({ message: "Failed to update language servers" }),
				),
			),
	});
	const restart = useMutation({
		mutationFn: (serverId: LspServerId) => {
			if (!client) throw new Error("Host unavailable");
			return client.lsp.restart.mutate({ serverId });
		},
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["lsp-status", hostUrl] }),
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({ message: "Failed to restart language server" }),
				),
			),
	});
	return (
		<section aria-labelledby="lsp-title" className="space-y-3">
			<div>
				<h3 id="lsp-title" className="text-sm font-medium">
					<Trans>Language servers</Trans>
				</h3>
				<p className="text-xs text-muted-foreground mt-1">
					<Trans>
						Code intelligence for the local v2 editor. Servers start when you
						open a supported file and use your installed tools.
					</Trans>
				</p>
			</div>
			{settings.isError && (
				<p className="text-sm text-destructive" role="alert">
					{errorMessage(
						settings.error,
						t({ message: "Failed to load language server settings" }),
					)}
				</p>
			)}
			{settings.data &&
				LSP_SERVER_IDS.map((serverId) => (
					<LspServerCard
						key={serverId}
						serverId={serverId}
						settings={settings.data.servers[serverId]}
						installed={
							availability.data?.find((entry) => entry.serverId === serverId)
								?.installed
						}
						running={
							status.data?.some(
								(entry) =>
									entry.serverId === serverId && entry.state === "running",
							) ?? false
						}
						disabled={save.isPending || restart.isPending}
						save={(value) => save.mutate({ serverId, value })}
						restart={() => restart.mutate(serverId)}
					/>
				))}
		</section>
	);
}
