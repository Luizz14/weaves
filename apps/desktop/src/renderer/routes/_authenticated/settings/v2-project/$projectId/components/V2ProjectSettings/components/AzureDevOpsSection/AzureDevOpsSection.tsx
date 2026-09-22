import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { LuLoaderCircle, LuRefreshCw, LuSave, LuTrash2 } from "react-icons/lu";
import { VscAzureDevops } from "react-icons/vsc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { SettingsSection } from "renderer/routes/_authenticated/settings/components/SettingsSection";
import { AzureBuildConfiguration } from "./components/AzureBuildConfiguration";
import { AzureDevOpsStatusIcon } from "./components/AzureDevOpsStatusIcon";
import type { AzureDevOpsDiagnosticStatus } from "./types";

type AzureDevOpsSectionProps = {
	projectId: string;
	hostUrl: string;
	isHostOnline: boolean;
};

const ORGANIZATION_URL_PATTERN =
	/^https:\/\/dev\.azure\.com\/[a-zA-Z0-9][a-zA-Z0-9-]*\/?$/;

function normalizeOrganizationUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function statusText(
	t: ReturnType<typeof useLingui>["t"],
	status: AzureDevOpsDiagnosticStatus,
): { title: string; description: string } {
	const textByStatus: Record<
		AzureDevOpsDiagnosticStatus,
		{ title: string; description: string }
	> = {
		host_unavailable: {
			title: t({ message: "Host unavailable" }),
			description: t({
				message: "The device that hosts this project is unavailable.",
			}),
		},
		not_configured: {
			title: t({ message: "Not configured" }),
			description: t({
				message: "Add the Azure DevOps project details to test this host.",
			}),
		},
		cli_missing: {
			title: t({ message: "Azure CLI not found" }),
			description: t({
				message: "Install Azure CLI on this host, then test again.",
			}),
		},
		extension_missing: {
			title: t({ message: "Azure DevOps extension not found" }),
			description: t({
				message: "Install the Azure DevOps CLI extension, then test again.",
			}),
		},
		authentication_required: {
			title: t({ message: "Authentication required" }),
			description: t({
				message: "Sign in to Azure DevOps on this host, then test again.",
			}),
		},
		access_denied: {
			title: t({ message: "Access denied" }),
			description: t({
				message: "The signed-in account cannot read this repository.",
			}),
		},
		repository_not_found: {
			title: t({ message: "Repository not found" }),
			description: t({
				message: "Check the organization, project, and repository names.",
			}),
		},
		network_error: {
			title: t({ message: "Azure DevOps is unreachable" }),
			description: t({
				message: "Check this host's network connection, proxy, or VPN.",
			}),
		},
		timeout: {
			title: t({ message: "Connection test timed out" }),
			description: t({
				message: "Azure CLI did not finish in time. Try the test again.",
			}),
		},
		command_failed: {
			title: t({ message: "Connection test failed" }),
			description: t({
				message: "Azure CLI returned an unexpected response on this host.",
			}),
		},
		ready: {
			title: t({ message: "Connected" }),
			description: t({
				message: "Azure CLI can read the configured repository.",
			}),
		},
	};
	return textByStatus[status];
}

export function AzureDevOpsSection({
	projectId,
	hostUrl,
	isHostOnline,
}: AzureDevOpsSectionProps) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const configQueryKey = useMemo(
		() => ["azure-devops", "project-config", hostUrl, projectId] as const,
		[hostUrl, projectId],
	);
	const diagnosticQueryKey = useMemo(
		() => ["azure-devops", "diagnostic", hostUrl, projectId] as const,
		[hostUrl, projectId],
	);
	const configQuery = useQuery({
		queryKey: configQueryKey,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.getProjectConfig.query({
				projectId,
			}),
		enabled: isHostOnline,
	});
	const diagnosticQuery = useQuery({
		queryKey: diagnosticQueryKey,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.diagnoseProject.query({
				projectId,
			}),
		enabled: isHostOnline && configQuery.data !== undefined,
		staleTime: 30_000,
		retry: false,
	});

	const [organizationUrl, setOrganizationUrl] = useState("");
	const [azureProject, setAzureProject] = useState("");
	const [repository, setRepository] = useState("");

	useEffect(() => {
		if (configQuery.data === undefined) return;
		setOrganizationUrl(configQuery.data?.organizationUrl ?? "");
		setAzureProject(configQuery.data?.azureProject ?? "");
		setRepository(configQuery.data?.repository ?? "");
	}, [configQuery.data]);

	const normalizedOrganizationUrl = normalizeOrganizationUrl(organizationUrl);
	const normalizedAzureProject = azureProject.trim();
	const normalizedRepository = repository.trim();
	const organizationUrlIsValid = ORGANIZATION_URL_PATTERN.test(
		normalizedOrganizationUrl,
	);
	const formIsComplete =
		organizationUrlIsValid &&
		normalizedAzureProject.length > 0 &&
		normalizedRepository.length > 0;
	const config = configQuery.data;
	const isDirty = config
		? normalizedOrganizationUrl !== config.organizationUrl ||
			normalizedAzureProject !== config.azureProject ||
			normalizedRepository !== config.repository
		: organizationUrl.length > 0 ||
			azureProject.length > 0 ||
			repository.length > 0;

	const saveMutation = useMutation({
		mutationFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.setProjectConfig.mutate({
				projectId,
				organizationUrl: normalizedOrganizationUrl,
				azureProject: normalizedAzureProject,
				repository: normalizedRepository,
			}),
		onSuccess: async (savedConfig) => {
			queryClient.setQueryData(configQueryKey, savedConfig);
			await queryClient.invalidateQueries({ queryKey: diagnosticQueryKey });
			toast.success(t({ message: "Azure DevOps configuration saved" }));
		},
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({ message: "Failed to save Azure DevOps configuration" }),
				),
			),
	});

	const removeMutation = useMutation({
		mutationFn: () =>
			getHostServiceClientByUrl(hostUrl).azureDevOps.removeProjectConfig.mutate(
				{
					projectId,
				},
			),
		onSuccess: () => {
			queryClient.setQueryData(configQueryKey, null);
			queryClient.setQueryData(diagnosticQueryKey, undefined);
			setOrganizationUrl("");
			setAzureProject("");
			setRepository("");
			toast.success(t({ message: "Azure DevOps configuration removed" }));
		},
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({ message: "Failed to remove Azure DevOps configuration" }),
				),
			),
	});

	const diagnostic = diagnosticQuery.data;
	const status: AzureDevOpsDiagnosticStatus = !isHostOnline
		? "host_unavailable"
		: diagnosticQuery.error
			? "command_failed"
			: (diagnostic?.status ?? "not_configured");
	const statusCopy = statusText(t, status);
	const isBusy = saveMutation.isPending || removeMutation.isPending;

	return (
		<SettingsSection
			title={t({ message: "Azure DevOps" })}
			icon={<VscAzureDevops className="size-4 text-[#0078d4]" />}
			description={t({
				message:
					"Use the Azure CLI session on this host for repositories, work items, and pipelines.",
			})}
		>
			<div className="rounded-xl bg-muted/20 p-1 shadow-[0_0_0_1px_var(--border),0_1px_2px_-1px_rgb(0_0_0/0.08),0_2px_4px_rgb(0_0_0/0.04)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
				<div className="rounded-lg bg-background p-4">
					<div className="grid gap-4 md:grid-cols-3">
						<div className="space-y-1.5">
							<Label htmlFor="azure-devops-organization">
								<Trans>Organization URL</Trans>
							</Label>
							<Input
								id="azure-devops-organization"
								value={organizationUrl}
								onChange={(event) => setOrganizationUrl(event.target.value)}
								placeholder="https://dev.azure.com/acme"
								autoCapitalize="none"
								autoCorrect="off"
								spellCheck={false}
								maxLength={2048}
								aria-invalid={
									organizationUrl.length > 0 && !organizationUrlIsValid
								}
								disabled={!isHostOnline || isBusy}
							/>
							{organizationUrl.length > 0 && !organizationUrlIsValid ? (
								<p className="text-pretty text-xs text-destructive">
									<Trans>
										Use a URL like https://dev.azure.com/organization.
									</Trans>
								</p>
							) : null}
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="azure-devops-project">
								<Trans>Project</Trans>
							</Label>
							<Input
								id="azure-devops-project"
								value={azureProject}
								onChange={(event) => setAzureProject(event.target.value)}
								placeholder={t({ message: "Azure project" })}
								maxLength={256}
								disabled={!isHostOnline || isBusy}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="azure-devops-repository">
								<Trans>Repository</Trans>
							</Label>
							<Input
								id="azure-devops-repository"
								value={repository}
								onChange={(event) => setRepository(event.target.value)}
								placeholder={t({ message: "Repository name" })}
								maxLength={256}
								disabled={!isHostOnline || isBusy}
							/>
						</div>
					</div>

					<div className="mt-4 flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="lg"
							className="transition-[transform,background-color,box-shadow] duration-150 ease-out active:not-disabled:scale-[0.96]"
							disabled={!isHostOnline || !formIsComplete || !isDirty || isBusy}
							onClick={() => saveMutation.mutate()}
						>
							{saveMutation.isPending ? (
								<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
							) : (
								<LuSave />
							)}
							<Trans>Save and test</Trans>
						</Button>
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="transition-[transform,background-color,box-shadow] duration-150 ease-out active:not-disabled:scale-[0.96]"
							disabled={
								!isHostOnline ||
								!config ||
								isDirty ||
								diagnosticQuery.isFetching ||
								isBusy
							}
							onClick={() => diagnosticQuery.refetch()}
						>
							<LuRefreshCw
								className={cn(
									diagnosticQuery.isFetching &&
										"animate-spin motion-reduce:animate-none",
								)}
							/>
							<Trans>Test again</Trans>
						</Button>
						{config ? (
							<Button
								type="button"
								variant="ghost"
								size="lg"
								className="text-destructive transition-[transform,background-color] duration-150 ease-out hover:text-destructive active:not-disabled:scale-[0.96]"
								disabled={!isHostOnline || isBusy}
								onClick={() => removeMutation.mutate()}
							>
								<LuTrash2 />
								<Trans>Remove</Trans>
							</Button>
						) : null}
					</div>
				</div>

				<div
					className="mt-px flex items-start gap-3 rounded-lg bg-background px-4 py-3"
					aria-live="polite"
				>
					<div className="mt-0.5 shrink-0">
						<AzureDevOpsStatusIcon
							status={status}
							isFetching={diagnosticQuery.isFetching}
						/>
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-balance">
							{diagnosticQuery.isFetching
								? t({ message: "Testing connection…" })
								: statusCopy.title}
						</p>
						<p className="mt-0.5 text-pretty text-xs text-muted-foreground">
							{diagnosticQuery.isFetching
								? t({
										message:
											"Checking Azure CLI, the Azure DevOps extension, and repository access.",
									})
								: statusCopy.description}
						</p>
						{diagnostic?.cliVersion || diagnostic?.extensionVersion ? (
							<p className="mt-2 text-xs text-muted-foreground">
								{diagnostic.cliVersion ? (
									<span>Azure CLI {diagnostic.cliVersion}</span>
								) : null}
								{diagnostic.cliVersion && diagnostic.extensionVersion ? (
									<span aria-hidden="true"> · </span>
								) : null}
								{diagnostic.extensionVersion ? (
									<span>
										<Trans>Extension {diagnostic.extensionVersion}</Trans>
									</span>
								) : null}
							</p>
						) : null}
						{status === "extension_missing" ? (
							<code className="mt-2 inline-block select-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
								az extension add --name azure-devops
							</code>
						) : null}
						{status === "authentication_required" && config ? (
							<div className="mt-2 flex flex-col items-start gap-1">
								<code className="select-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
									az login
								</code>
								<code className="select-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
									az devops login --organization {config.organizationUrl}
								</code>
							</div>
						) : null}
						{diagnostic?.repository ? (
							<a
								href={diagnostic.repository.webUrl}
								target="_blank"
								rel="noreferrer"
								className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
							>
								{diagnostic.repository.projectName} /{" "}
								{diagnostic.repository.name}
							</a>
						) : null}
					</div>
				</div>
			</div>
			<AzureBuildConfiguration
				projectId={projectId}
				hostUrl={hostUrl}
				isHostOnline={isHostOnline}
			/>
		</SettingsSection>
	);
}
