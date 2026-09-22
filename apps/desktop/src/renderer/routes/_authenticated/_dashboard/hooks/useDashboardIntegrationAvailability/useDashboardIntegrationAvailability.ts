import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { useActiveOrganizationId } from "renderer/hooks/useActiveOrganizationId";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useProjectQueryTargets } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";
import {
	getAvailablePullRequestProviders,
	getAvailableTaskSources,
	type PullRequestProvider,
	resolvePullRequestProvider,
	resolveTaskSource,
} from "./availability";

export type { PullRequestProvider } from "./availability";
export {
	getAvailablePullRequestProviders,
	getAvailableTaskSources,
	resolvePullRequestProvider,
	resolveTaskSource,
	shouldShowPullRequestProviderSwitcher,
	shouldShowTaskSourceSwitcher,
} from "./availability";

export function useDashboardIntegrationAvailability() {
	const organizationId = useActiveOrganizationId();
	const { data: integrations, isFetched: areIntegrationsFetched } =
		cloudTrpc.integration.list.useQuery(
			{ organizationId: organizationId ?? "" },
			{ enabled: !!organizationId },
		);
	const { data: githubRepositories, isFetched: areGithubRepositoriesFetched } =
		cloudTrpc.integration.github.listRepositories.useQuery(
			{ organizationId: organizationId ?? "" },
			{ enabled: !!organizationId },
		);
	const { data: githubInstallation, isFetched: isGithubInstallationFetched } =
		useQuery({
			queryKey: ["integration", "github", "installation", organizationId],
			queryFn: async () => {
				try {
					return await apiTrpcClient.integration.github.getInstallation.query({
						organizationId: organizationId ?? "",
					});
				} catch {
					return null;
				}
			},
			enabled: !!organizationId,
			retry: false,
		});

	const { localHostId, otherHosts } = useWorkspaceHostOptions();
	const hostIds = useMemo(
		() =>
			[
				...(localHostId ? [localHostId] : []),
				...otherHosts.filter((host) => host.isOnline).map((host) => host.id),
			].filter((hostId, index, all) => all.indexOf(hostId) === index),
		[localHostId, otherHosts],
	);
	const hostTargets = useHostUrls(hostIds);
	const boardConfigQueries = useQueries({
		queries: hostTargets.map((target) => ({
			queryKey: ["azure-devops", "board-config", target.hostId, target.url],
			enabled: target.url !== null,
			queryFn: () =>
				target.url
					? getHostServiceClientByUrl(
							target.url,
						).azureDevOps.getBoardConfig.query()
					: null,
			retry: false,
		})),
	});

	const {
		projects,
		targets: allProjectTargets,
		isReady: areProjectsReady,
	} = useProjectQueryTargets([]);
	const projectConfigQueries = useQueries({
		queries: allProjectTargets.map((target) => ({
			queryKey: [
				"azure-devops",
				"project-config",
				target.hostUrl,
				target.projectId,
			],
			enabled: target.hostUrl !== null,
			queryFn: () =>
				target.hostUrl
					? getHostServiceClientByUrl(
							target.hostUrl,
						).azureDevOps.getProjectConfig.query({
							projectId: target.projectId,
						})
					: null,
			retry: false,
		})),
	});

	const linearConnected =
		integrations?.some((entry) => entry.provider === "linear") ?? false;
	const githubConnected = !!githubInstallation && !githubInstallation.suspended;
	const githubRepositoryCount = githubRepositories?.length ?? 0;
	const azureProjectIds = useMemo(
		() =>
			new Set(
				projectConfigQueries.flatMap((query, index) =>
					query.data
						? [allProjectTargets[index]?.projectId].filter(
								(projectId): projectId is string => projectId !== undefined,
							)
						: [],
				),
			),
		[allProjectTargets, projectConfigQueries],
	);
	const githubProjectIds = useMemo(() => {
		const connectedRepos = new Set(
			(githubRepositories ?? []).map((repo) =>
				`${repo.owner}/${repo.name}`.toLocaleLowerCase(),
			),
		);
		return new Set(
			projects.flatMap((project) => {
				const slug =
					project.repoOwner && project.repoName
						? `${project.repoOwner}/${project.repoName}`.toLocaleLowerCase()
						: null;
				return slug && connectedRepos.has(slug) ? [project.projectKey] : [];
			}),
		);
	}, [githubRepositories, projects]);

	const taskSources = getAvailableTaskSources({
		linear: linearConnected,
		github: githubConnected,
		azureDevOps: boardConfigQueries.some((query) => query.data != null),
	});
	const pullRequestProviders = getAvailablePullRequestProviders({
		githubRepositoryCount,
		azureProjectCount: azureProjectIds.size,
	});
	const isHostQueryResolved = (index: number) =>
		hostTargets[index]?.url == null ||
		boardConfigQueries[index]?.isFetched === true;
	const isProjectQueryResolved = (index: number) =>
		allProjectTargets[index]?.hostUrl == null ||
		projectConfigQueries[index]?.isFetched === true;

	return {
		taskSources,
		pullRequestProviders,
		azureProjectIds,
		githubProjectIds,
		allProjectTargets,
		isReady:
			!!organizationId &&
			areIntegrationsFetched &&
			areGithubRepositoriesFetched &&
			isGithubInstallationFetched &&
			areProjectsReady &&
			hostTargets.every((_target, index) => isHostQueryResolved(index)) &&
			allProjectTargets.every((_target, index) =>
				isProjectQueryResolved(index),
			),
		resolveTaskSource: (requested: Parameters<typeof resolveTaskSource>[0]) =>
			resolveTaskSource(requested, taskSources),
		resolvePullRequestProvider: (requested: PullRequestProvider) =>
			resolvePullRequestProvider(requested, pullRequestProviders),
	};
}
