import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import type { HostWorkspaceItem } from "renderer/hooks/host-workspaces/useHostWorkspaces";
import {
	getHostServiceClientByUrl,
	type HostServiceClient,
} from "renderer/lib/host-service-client";

export type AzureBuildWorkspace = Pick<
	HostWorkspaceItem,
	"id" | "hostId" | "projectId" | "branch"
>;

export type AzureBuildOptions = Omit<
	Parameters<HostServiceClient["azureDevOps"]["generateBuild"]["mutate"]>[0],
	"workspaceId" | "workItemId"
>;
export type AzureBuildConfig = NonNullable<
	Awaited<
		ReturnType<HostServiceClient["azureDevOps"]["getBuildConfig"]["query"]>
	>
>;

export function workItemNumberFromBranch(branch: string): string {
	return /\d{4,}/.exec(branch)?.[0] ?? "";
}

export function useAzureBuild({
	workspace,
	workItemId,
	onStarted,
}: {
	workspace: AzureBuildWorkspace;
	workItemId: number;
	onStarted: () => void;
}) {
	const { t } = useLingui();
	const hostUrl = useHostUrl(workspace.hostId);
	const projectId = workspace.projectId;
	const inFlight = useRef(false);
	const configQuery = useQuery({
		queryKey: ["azure-devops", "build-config", hostUrl, projectId],
		enabled: hostUrl !== null && projectId !== null,
		queryFn: () => {
			if (!hostUrl || !projectId)
				throw new Error("Build project is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.getBuildConfig.query({ projectId });
		},
	});
	const mutation = useMutation({
		mutationFn: (options: AzureBuildOptions) => {
			if (!hostUrl) throw new Error("Build workspace is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.generateBuild.mutate({
				...options,
				workItemId,
				workspaceId: workspace.id,
			});
		},
		retry: false,
		onSuccess: (result) => {
			toast.success(t({ message: "Build started" }), {
				description: `${result.platform.toUpperCase()} · ${result.lane} · ${result.branch}`,
			});
			onStarted();
		},
		onError: (error) =>
			toast.error(errorMessage(error, t({ message: "Failed to start build" }))),
		onSettled: () => {
			inFlight.current = false;
		},
	});
	const generate = (options: AzureBuildOptions) => {
		if (inFlight.current) return;
		inFlight.current = true;
		mutation.mutate(options);
	};
	return { configQuery, generate, isPending: mutation.isPending, hostUrl };
}
