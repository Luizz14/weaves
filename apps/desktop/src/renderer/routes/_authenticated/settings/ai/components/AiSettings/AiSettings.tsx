import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getHostServiceUnavailableMessage } from "renderer/lib/host-service-unavailable";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	HostSelect,
	type HostSelectOption,
} from "../../../components/HostSelect";
import { SettingsRow } from "../../../components/SettingsRow";

interface AiSettingsProps {
	hostId: string | null;
}

const MODELS = [
	{ id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
	{ id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
	{ id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
	{ id: "gemini-3.7-flash-low", label: "Gemini 3.7 Flash (Low)" },
	{ id: "gemini-3.7-flash-medium", label: "Gemini 3.7 Flash (Medium)" },
	{ id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" },
	{ id: "gemini-3.6-flash-low", label: "Gemini 3.6 Flash (Low)" },
	{ id: "gemini-3.6-flash-medium", label: "Gemini 3.6 Flash (Medium)" },
	{ id: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" },
	{ id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
	{ id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
] as const;

export function AiSettings({ hostId }: AiSettingsProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const hostService = useLocalHostService();
	const { machineId } = hostService;
	const { currentDeviceName, localHostId, otherHosts } =
		useWorkspaceHostOptions();
	const targetHostUrl = useHostUrl(hostId);
	const targetHostId = hostId ?? machineId;
	const queryClient = useQueryClient();

	const hostOptions = useMemo<HostSelectOption[]>(() => {
		const thisDevice = t({ message: "This device" });
		const options: HostSelectOption[] = [];
		if (localHostId) {
			options.push({
				id: localHostId,
				name: currentDeviceName ?? thisDevice,
				isLocal: true,
				isOnline: true,
			});
		}
		for (const host of otherHosts) {
			options.push({
				id: host.id,
				name: host.name,
				isLocal: false,
				isOnline: host.isOnline,
			});
		}
		return options;
	}, [currentDeviceName, localHostId, otherHosts, t]);
	const selectedHost = hostOptions.find((host) => host.id === targetHostId);
	const isHostOnline = selectedHost?.isOnline ?? true;

	const settingsQuery = useQuery({
		queryKey: ["host-quick-ai-settings", targetHostUrl] as const,
		enabled: !!targetHostUrl && isHostOnline,
		queryFn: () => {
			if (!targetHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				targetHostUrl,
			).settings.quickAi.get.query();
		},
	});
	const statusQuery = useQuery({
		queryKey: ["host-quick-ai-status", targetHostUrl] as const,
		enabled: !!targetHostUrl && isHostOnline,
		queryFn: () => {
			if (!targetHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				targetHostUrl,
			).settings.quickAi.status.query();
		},
	});

	const setMutation = useMutation({
		mutationFn: (model: (typeof MODELS)[number]["id"]) => {
			if (!targetHostUrl) {
				throw new Error(
					getHostServiceUnavailableMessage(hostService, {
						action: "updateQuickAiSettings",
					}),
				);
			}
			return getHostServiceClientByUrl(
				targetHostUrl,
			).settings.quickAi.set.mutate({ provider: "agy", model });
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["host-quick-ai-settings", targetHostUrl],
			});
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to update AI settings" })),
			),
	});

	const testMutation = useMutation({
		mutationFn: () => {
			if (!targetHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				targetHostUrl,
			).settings.quickAi.testConnection.mutate();
		},
		onSuccess: () => toast.success(t({ message: "Antigravity CLI is ready" })),
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({ message: "Antigravity CLI connection failed" }),
				),
			),
	});

	const disabled =
		!targetHostUrl ||
		!isHostOnline ||
		settingsQuery.isLoading ||
		setMutation.isPending;

	return (
		<div className="mx-auto w-full max-w-4xl p-6 select-text">
			<header className="mb-8 flex items-center justify-between gap-4">
				<div className="min-w-0">
					<h2 className="text-xl font-semibold">
						<Trans>AI features</Trans>
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						<Trans>
							Use a small local CLI model for branch names, commit messages, and
							pull request drafts.
						</Trans>
					</p>
				</div>
				{hostOptions.length > 1 && targetHostId ? (
					<HostSelect
						value={targetHostId}
						options={hostOptions}
						onValueChange={(nextHostId) => {
							void navigate({
								to: "/settings/ai",
								search: { hostId: nextHostId },
								replace: true,
							});
						}}
					/>
				) : null}
			</header>

			<section>
				<SettingsRow
					label={t({ message: "Provider" })}
					hint={t({
						message:
							"Uses the Antigravity CLI and its existing login on this host.",
					})}
				>
					<div className="text-sm font-medium">Antigravity CLI (agy)</div>
				</SettingsRow>
				<SettingsRow
					label={t({ message: "Model" })}
					hint={t({
						message:
							"Flash balances speed and quality for short development tasks.",
					})}
				>
					<Select
						value={settingsQuery.data?.model ?? "gemini-3.8-flash-low"}
						onValueChange={(model) =>
							setMutation.mutate(model as (typeof MODELS)[number]["id"])
						}
						disabled={disabled}
					>
						<SelectTrigger className="w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MODELS.map((model) => (
								<SelectItem key={model.id} value={model.id}>
									{model.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label={t({ message: "Antigravity CLI status" })}
					hint={
						statusQuery.data?.installed ? (
							<Trans>Installed version {statusQuery.data.version}</Trans>
						) : (
							<Trans>
								Install the Antigravity CLI, then run agy in a terminal to sign
								in.
							</Trans>
						)
					}
				>
					<Button
						variant="outline"
						size="sm"
						disabled={
							disabled || !statusQuery.data?.installed || testMutation.isPending
						}
						onClick={() => testMutation.mutate()}
					>
						{testMutation.isPending ? (
							<Trans>Testing...</Trans>
						) : (
							<Trans>Test connection</Trans>
						)}
					</Button>
				</SettingsRow>
			</section>
		</div>
	);
}
