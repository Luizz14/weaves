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
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LuRefreshCw, LuUserRound, LuUsersRound } from "react-icons/lu";
import { VscAzureDevops } from "react-icons/vsc";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { AzureDevOpsBoard } from "./components/AzureDevOpsBoard";
import { AzureDevOpsEmptyState } from "./components/AzureDevOpsEmptyState";
import { AzureDevOpsSetupDialog } from "./components/AzureDevOpsSetupDialog";
import type {
	AzureDevOpsBoardDisplayItem,
	AzureDevOpsBoardStage,
} from "./types";

type AzureDevOpsContentProps = {
	searchQuery: string;
};

const boardQueryKey = (
	hostUrl: string,
	iterationPath: string | undefined,
	includeClaimed: boolean,
) =>
	[
		"azure-devops",
		"board",
		hostUrl,
		iterationPath ?? "current",
		includeClaimed,
	] as const;

export function AzureDevOpsContent({ searchQuery }: AzureDevOpsContentProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { currentDeviceName, localHostId, activeHostUrl, otherHosts } =
		useWorkspaceHostOptions();
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
	const configuredTarget =
		configuredIndex >= 0 ? hostTargets[configuredIndex] : null;
	const targetHostUrl = configuredTarget?.url ?? null;
	const targetHostId = configuredTarget?.hostId ?? localHostId;
	const [selectedIteration, setSelectedIteration] = useState<
		string | undefined
	>();
	const [includeClaimed, setIncludeClaimed] = useState(false);
	const [setupOpen, setSetupOpen] = useState(false);
	const [optimisticStages, setOptimisticStages] = useState<
		ReadonlyMap<number, AzureDevOpsBoardStage>
	>(new Map());
	const boardQuery = useQuery({
		queryKey: targetHostUrl
			? boardQueryKey(targetHostUrl, selectedIteration, includeClaimed)
			: ["azure-devops", "board", "unconfigured"],
		enabled: targetHostUrl !== null,
		queryFn: () =>
			targetHostUrl
				? getHostServiceClientByUrl(targetHostUrl).azureDevOps.listBoard.query({
						iterationPath: selectedIteration,
						includeClaimed,
					})
				: null,
		refetchInterval: 30_000,
		placeholderData: (previous) => previous,
	});
	const { workspaces } = useHostWorkspaces();
	const linkedAzureWorkspaces = useMemo(
		() =>
			workspaces.filter(
				(workspace) =>
					workspace.externalWorkItemProvider === "azure-devops" &&
					workspace.externalWorkItemId != null,
			),
		[workspaces],
	);
	const pullRequestHostIds = useMemo(
		() => [
			...new Set(linkedAzureWorkspaces.map((workspace) => workspace.hostId)),
		],
		[linkedAzureWorkspaces],
	);
	const pullRequestHostTargets = useHostUrls(pullRequestHostIds);
	const pullRequestQueries = useQueries({
		queries: pullRequestHostTargets.map((target) => {
			const workspaceIds = linkedAzureWorkspaces
				.filter((workspace) => workspace.hostId === target.hostId)
				.map((workspace) => workspace.id);
			return {
				queryKey: [
					"azure-devops",
					"workspace-pull-requests",
					target.hostId,
					workspaceIds,
				],
				enabled: target.url !== null && workspaceIds.length > 0,
				queryFn: () =>
					target.url
						? getHostServiceClientByUrl(
								target.url,
							).pullRequests.getByWorkspaces.query({ workspaceIds })
						: null,
				refetchInterval: 30_000,
			};
		}),
	});
	const pullRequestByWorkspaceId = useMemo(() => {
		const byWorkspace = new Map<
			string,
			{ number: number; state: string } | null
		>();
		for (const query of pullRequestQueries) {
			for (const row of query.data?.workspaces ?? []) {
				byWorkspace.set(
					row.workspaceId,
					row.pullRequest
						? {
								number: row.pullRequest.number,
								state: row.pullRequest.state,
							}
						: null,
				);
			}
		}
		return byWorkspace;
	}, [pullRequestQueries]);
	const livePullRequestTargets = useMemo(
		() =>
			linkedAzureWorkspaces.flatMap((workspace) => {
				const pullRequest = pullRequestByWorkspaceId.get(workspace.id);
				const hostUrl = pullRequestHostTargets.find(
					(target) => target.hostId === workspace.hostId,
				)?.url;
				if (!pullRequest || !workspace.projectId || !hostUrl) return [];
				return [
					{
						workspaceId: workspace.id,
						projectId: workspace.projectId,
						pullRequestId: pullRequest.number,
						hostUrl,
					},
				];
			}),
		[linkedAzureWorkspaces, pullRequestByWorkspaceId, pullRequestHostTargets],
	);
	const livePullRequestQueries = useQueries({
		queries: livePullRequestTargets.map((target) => ({
			queryKey: [
				"azure-devops",
				"pull-request",
				target.hostUrl,
				target.projectId,
				target.pullRequestId,
			],
			queryFn: () =>
				getHostServiceClientByUrl(
					target.hostUrl,
				).azureDevOps.getPullRequest.query({
					projectId: target.projectId,
					pullRequestId: target.pullRequestId,
				}),
			refetchInterval: 30_000,
			retry: false,
		})),
	});
	const livePullRequestStateByWorkspaceId = useMemo(() => {
		const states = new Map<string, string>();
		for (const [index, query] of livePullRequestQueries.entries()) {
			const target = livePullRequestTargets[index];
			if (target && query.data) {
				states.set(target.workspaceId, query.data.state);
			}
		}
		return states;
	}, [livePullRequestQueries, livePullRequestTargets]);
	const workspaceCountByItem = useMemo(() => {
		const counts = new Map<number, number>();
		for (const workspace of linkedAzureWorkspaces) {
			if (workspace.externalWorkItemProvider !== "azure-devops") continue;
			const workItemId = Number(workspace.externalWorkItemId);
			if (!Number.isInteger(workItemId)) continue;
			counts.set(workItemId, (counts.get(workItemId) ?? 0) + 1);
		}
		return counts;
	}, [linkedAzureWorkspaces]);
	const pullRequestCountByItem = useMemo(() => {
		const counts = new Map<number, number>();
		for (const workspace of linkedAzureWorkspaces) {
			const workItemId = Number(workspace.externalWorkItemId);
			if (!Number.isInteger(workItemId)) continue;
			if (pullRequestByWorkspaceId.get(workspace.id)) {
				counts.set(workItemId, (counts.get(workItemId) ?? 0) + 1);
			}
		}
		return counts;
	}, [linkedAzureWorkspaces, pullRequestByWorkspaceId]);
	const completedWorkItems = useMemo(() => {
		const workspaceStates = new Map<number, boolean[]>();
		for (const workspace of linkedAzureWorkspaces) {
			const workItemId = Number(workspace.externalWorkItemId);
			if (!Number.isInteger(workItemId)) continue;
			const states = workspaceStates.get(workItemId) ?? [];
			states.push(
				(livePullRequestStateByWorkspaceId.get(workspace.id) ??
					pullRequestByWorkspaceId.get(workspace.id)?.state) === "merged",
			);
			workspaceStates.set(workItemId, states);
		}
		return new Set(
			[...workspaceStates.entries()]
				.filter(([, states]) => states.length > 0 && states.every(Boolean))
				.map(([workItemId]) => workItemId),
		);
	}, [
		linkedAzureWorkspaces,
		livePullRequestStateByWorkspaceId,
		pullRequestByWorkspaceId,
	]);
	const items = useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
		return (boardQuery.data?.items ?? [])
			.filter(
				(item) =>
					!normalizedQuery ||
					item.title.toLocaleLowerCase().includes(normalizedQuery) ||
					String(item.id).includes(normalizedQuery) ||
					item.tags.some((tag) =>
						tag.toLocaleLowerCase().includes(normalizedQuery),
					),
			)
			.map((item) => ({
				...item,
				stage: completedWorkItems.has(item.id)
					? ("completed" as const)
					: (optimisticStages.get(item.id) ?? item.stage),
			}));
	}, [
		boardQuery.data?.items,
		completedWorkItems,
		optimisticStages,
		searchQuery,
	]);
	const move = useMutation({
		mutationFn: async ({
			item,
			stage,
		}: {
			item: AzureDevOpsBoardDisplayItem;
			stage: AzureDevOpsBoardStage;
		}) => {
			if (!targetHostUrl || !boardQuery.data?.iterationPath) {
				throw new Error("Azure DevOps host is unavailable");
			}
			const client = getHostServiceClientByUrl(targetHostUrl);
			if (item.stage === "backlog" && stage === "implementation") {
				return client.azureDevOps.claimWorkItem.mutate({
					workItemId: item.id,
					iterationPath: boardQuery.data.iterationPath,
				});
			}
			if (stage === "completed" || stage === "backlog") {
				throw new Error("This stage is automatic");
			}
			return client.azureDevOps.setWorkItemStage.mutate({
				workItemId: item.id,
				stage,
			});
		},
		onError: (error, variables) => {
			setOptimisticStages((current) => {
				const next = new Map(current);
				next.delete(variables.item.id);
				return next;
			});
			toast.error(
				errorMessage(error, t({ message: "Failed to move work item" })),
			);
		},
		onSettled: () => {
			if (!targetHostUrl) return;
			void queryClient.invalidateQueries({
				queryKey: ["azure-devops", "board", targetHostUrl],
			});
		},
	});
	const handleMove = (
		item: AzureDevOpsBoardDisplayItem,
		stage: AzureDevOpsBoardStage,
	) => {
		setOptimisticStages((current) => new Map(current).set(item.id, stage));
		move.mutate({ item, stage });
	};
	const targetName =
		targetHostId === localHostId
			? (currentDeviceName ?? t({ message: "This device" }))
			: (otherHosts.find((host) => host.id === targetHostId)?.name ??
				t({ message: "Azure host" }));

	if (configuredIndex < 0 && configQueries.some((query) => query.isPending)) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				<LuRefreshCw className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
				<Trans>Looking for an Azure DevOps board…</Trans>
			</div>
		);
	}

	if (!targetHostUrl) {
		return (
			<>
				<AzureDevOpsEmptyState
					canConnect={activeHostUrl !== null}
					onConnect={() => setSetupOpen(true)}
				/>
				<AzureDevOpsSetupDialog
					hostUrl={activeHostUrl}
					open={setupOpen}
					onOpenChange={setSetupOpen}
					onConfigured={() =>
						queryClient.invalidateQueries({
							queryKey: ["azure-devops", "board-config"],
						})
					}
				/>
			</>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
			<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
				<div className="mr-auto flex min-w-0 items-center gap-2">
					<h2 className="text-balance text-lg font-semibold">
						<Trans>Work</Trans>
					</h2>
					<span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground">
						<VscAzureDevops className="size-3.5 text-[#0078d4]" />
						Azure DevOps
					</span>
				</div>
				<Select
					value={selectedIteration ?? boardQuery.data?.iterationPath ?? ""}
					onValueChange={(value) => setSelectedIteration(value)}
				>
					<SelectTrigger className="h-9 w-56">
						<SelectValue placeholder={t({ message: "Current sprint" })} />
					</SelectTrigger>
					<SelectContent>
						{boardQuery.data?.iterations.map((iteration) => (
							<SelectItem key={iteration.id} value={iteration.path}>
								{iteration.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="outline"
					className="h-9 transition-[transform,background-color] active:not-disabled:scale-[0.96]"
					onClick={() => setIncludeClaimed((current) => !current)}
				>
					{includeClaimed ? <LuUsersRound /> : <LuUserRound />}
					{includeClaimed ? <Trans>All</Trans> : <Trans>Mine</Trans>}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-lg"
					className="transition-[transform,background-color] active:not-disabled:scale-[0.96]"
					aria-label={t({ message: "Refresh Azure DevOps board" })}
					title={t({ message: `Azure CLI on ${targetName}` })}
					disabled={boardQuery.isFetching}
					onClick={() => boardQuery.refetch()}
				>
					<LuRefreshCw
						className={
							boardQuery.isFetching
								? "animate-spin motion-reduce:animate-none"
								: undefined
						}
					/>
				</Button>
			</div>
			{boardQuery.error ? (
				<div className="mx-4 mt-4 rounded-lg bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-[0_0_0_1px_rgb(239_68_68/0.2)]">
					{errorMessage(boardQuery.error)}
				</div>
			) : null}
			<AzureDevOpsBoard
				items={items}
				workspaceCountByItem={workspaceCountByItem}
				pullRequestCountByItem={pullRequestCountByItem}
				onMove={handleMove}
				onOpenItem={(item) =>
					navigate({
						to: "/tasks/azure/$workItemId",
						params: { workItemId: String(item.id) },
						search: {
							type: "azure",
							azureHost: targetHostId ?? undefined,
							iteration: boardQuery.data?.iterationPath ?? undefined,
						},
					})
				}
			/>
		</div>
	);
}
