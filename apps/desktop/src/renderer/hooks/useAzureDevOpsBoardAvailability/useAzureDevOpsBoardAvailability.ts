import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";

export function useAzureDevOpsBoardAvailability() {
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
	const configQueries = useQueries({
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
	const configuredIndex = configQueries.findIndex(
		(query) => query.data != null,
	);
	return {
		hasConfiguredBoard: configuredIndex >= 0,
		configuredTarget:
			configuredIndex >= 0 ? hostTargets[configuredIndex] : null,
		isLoading: hostTargets.some(
			(target, index) => target.url !== null && configQueries[index]?.isPending,
		),
		isReady: hostTargets.every(
			(target, index) =>
				target.url === null || configQueries[index]?.isFetched === true,
		),
	};
}
