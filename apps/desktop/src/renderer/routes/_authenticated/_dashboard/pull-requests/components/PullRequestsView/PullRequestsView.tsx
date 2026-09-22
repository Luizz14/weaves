import { Trans } from "@lingui/react/macro";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	resolvePullRequestProvider,
	useDashboardIntegrationAvailability,
} from "renderer/routes/_authenticated/_dashboard/hooks/useDashboardIntegrationAvailability";
import { useDebouncedSearchNavigation } from "renderer/routes/_authenticated/_dashboard/hooks/useDebouncedSearchNavigation";
import { useProjectQueryTargets } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";
import { normalizeAuthorFilters } from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/normalizeAuthorFilter";
import {
	normalizePullRequestReviewFilter,
	type PullRequestReviewFilter,
} from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/pullRequestReviewFilter";
import {
	pullRequestsSearchFromFilters,
	usePullRequestsFilterStore,
} from "../../stores/pullRequestsFilterStore";
import { AzurePullRequestsContent } from "./components/AzurePullRequestsContent";
import { PullRequestsContent } from "./components/PullRequestsContent";
import { PullRequestsTopBar } from "./components/PullRequestsTopBar";

interface PullRequestsViewProps {
	initialSearch?: string;
	initialProjects?: string[];
	initialAuthor?: string;
	initialReview?: string;
	initialState?: "open" | "all" | "merged";
	/** The PR currently open in the detail pane, if any — filter/search
	 *  changes navigate back to it instead of collapsing the detail pane. */
	selectedPrNumber?: number | null;
	/** The open PR's own project id — distinct from the list's `projects`
	 *  filter, and must survive filter-driven re-navigations. */
	selectedPrProjectId?: string | null;
	initialProvider?: "github" | "azure-devops";
}

export function PullRequestsView({
	initialSearch,
	initialProjects,
	initialAuthor,
	initialReview,
	initialState,
	selectedPrNumber = null,
	selectedPrProjectId = null,
	initialProvider = "github",
}: PullRequestsViewProps) {
	const navigate = useNavigate();
	const {
		isReady: areIntegrationsReady,
		pullRequestProviders,
		azureProjectIds,
		githubProjectIds,
	} = useDashboardIntegrationAvailability();
	const availableProvider = areIntegrationsReady
		? resolvePullRequestProvider(initialProvider, pullRequestProviders)
		: initialProvider;
	const {
		search: storedSearch,
		projectFilters: storedProjectFilters,
		authorFilter: storedAuthorFilter,
		reviewFilter: storedReviewFilter,
		includeClosed: storedIncludeClosed,
		mergedOnly: storedMergedOnly,
		setSearch: storeSetSearch,
		setProjectFilters: storeSetProjectFilters,
		setAuthorFilter: storeSetAuthorFilter,
		setReviewFilter: storeSetReviewFilter,
		setIncludeClosed: storeSetIncludeClosed,
		setMergedOnly: storeSetMergedOnly,
	} = usePullRequestsFilterStore();
	const [searchQuery, setSearchQuery] = useState(initialSearch ?? storedSearch);
	const provider = availableProvider ?? initialProvider;
	const projectFilters = initialProjects ?? storedProjectFilters;
	const authorFilter =
		initialAuthor === undefined
			? storedAuthorFilter
			: normalizeAuthorFilters(initialAuthor);
	const reviewFilter =
		initialReview === undefined
			? storedReviewFilter
			: normalizePullRequestReviewFilter(initialReview);
	const includeClosed =
		initialState === undefined
			? storedIncludeClosed
			: initialState === "all" || initialState === "merged";
	const mergedOnly =
		initialState === undefined ? storedMergedOnly : initialState === "merged";
	// Filter/search changes must not collapse an open detail pane.
	const navigateTo = useCallback(
		(search: Record<string, string>) => {
			const providerSearch =
				provider === "azure-devops"
					? { ...search, provider: "azure-devops" }
					: search;
			return selectedPrNumber != null
				? navigate({
						to: "/pull-requests/$prNumber",
						params: { prNumber: String(selectedPrNumber) },
						search: selectedPrProjectId
							? { ...providerSearch, project: selectedPrProjectId }
							: providerSearch,
						replace: true,
					})
				: navigate({
						to: "/pull-requests",
						search: providerSearch,
						replace: true,
					});
		},
		[navigate, selectedPrNumber, selectedPrProjectId, provider],
	);
	const {
		isReady: areProjectsReady,
		projects: hostProjects,
		targets: projectTargets,
	} = useProjectQueryTargets(projectFilters);
	const providerProjectIds =
		provider === "azure-devops" ? azureProjectIds : githubProjectIds;
	const allowedProjectIds = useMemo(
		() => Array.from(providerProjectIds),
		[providerProjectIds],
	);
	const providerTargets = useMemo(
		() =>
			projectTargets.filter((target) =>
				providerProjectIds.has(target.projectId),
			),
		[projectTargets, providerProjectIds],
	);

	// Sync only from the URL: depending on storedSearch would snap the input
	// back to the stale URL value on every keystroke until the debounced
	// navigation lands.
	useEffect(() => {
		if (initialSearch !== undefined) setSearchQuery(initialSearch);
	}, [initialSearch]);

	useEffect(() => {
		storeSetSearch(searchQuery);
	}, [searchQuery, storeSetSearch]);

	const buildSearch = useCallback(
		(overrides: {
			search?: string;
			projects?: string[];
			author?: string | null;
			review?: PullRequestReviewFilter | null;
			includeClosed?: boolean;
			mergedOnly?: boolean;
		}) =>
			pullRequestsSearchFromFilters({
				search: overrides.search ?? searchQuery,
				projectFilters:
					overrides.projects !== undefined
						? overrides.projects
						: projectFilters,
				authorFilter:
					overrides.author !== undefined ? overrides.author : authorFilter,
				reviewFilter:
					overrides.review !== undefined ? overrides.review : reviewFilter,
				includeClosed: overrides.includeClosed ?? includeClosed,
				mergedOnly: overrides.mergedOnly ?? mergedOnly,
			}),
		[
			authorFilter,
			includeClosed,
			mergedOnly,
			projectFilters,
			reviewFilter,
			searchQuery,
		],
	);
	const navigateSearch = useCallback(
		(query: string) => navigateTo(buildSearch({ search: query })),
		[buildSearch, navigateTo],
	);
	const {
		cancelPendingSearchNavigation,
		scheduleSearchNavigation: syncSearchToUrl,
	} = useDebouncedSearchNavigation(navigateSearch);

	useEffect(() => {
		if (!areIntegrationsReady || pullRequestProviders.length === 0) return;
		if (availableProvider === null || availableProvider === initialProvider)
			return;
		cancelPendingSearchNavigation();
		void navigate({
			to: "/pull-requests",
			search: {
				...buildSearch({}),
				...(availableProvider === "azure-devops"
					? { provider: "azure-devops" as const }
					: {}),
			},
			replace: true,
		});
	}, [
		areIntegrationsReady,
		pullRequestProviders,
		availableProvider,
		initialProvider,
		cancelPendingSearchNavigation,
		navigate,
		buildSearch,
	]);

	useEffect(() => {
		storeSetProjectFilters(projectFilters);
	}, [projectFilters, storeSetProjectFilters]);

	useEffect(() => {
		storeSetAuthorFilter(authorFilter);
	}, [authorFilter, storeSetAuthorFilter]);

	useEffect(() => {
		storeSetReviewFilter(reviewFilter);
	}, [reviewFilter, storeSetReviewFilter]);

	useEffect(() => {
		storeSetIncludeClosed(includeClosed);
	}, [includeClosed, storeSetIncludeClosed]);

	useEffect(() => {
		storeSetMergedOnly(mergedOnly);
	}, [mergedOnly, storeSetMergedOnly]);

	const projects = useMemo(
		() =>
			hostProjects
				.filter((project) => providerProjectIds.has(project.projectKey))
				.map((project) => ({
					id: project.projectKey,
					name: project.name,
				})),
		[hostProjects, providerProjectIds],
	);
	const repoSlugByProjectId = useMemo(
		() =>
			new Map(
				hostProjects.map((project) => [
					project.projectKey,
					project.repoOwner && project.repoName
						? `${project.repoOwner}/${project.repoName}`
						: project.name,
				]),
			),
		[hostProjects],
	);

	useEffect(() => {
		if (!areIntegrationsReady || !areProjectsReady) return;
		if (availableProvider !== initialProvider) return;
		const availableIds = providerProjectIds;
		const availableFilters = projectFilters.filter((projectId) =>
			availableIds.has(projectId),
		);
		if (availableFilters.length === projectFilters.length) return;
		cancelPendingSearchNavigation();
		navigateTo(buildSearch({ projects: availableFilters }));
	}, [
		areIntegrationsReady,
		areProjectsReady,
		availableProvider,
		initialProvider,
		providerProjectIds,
		buildSearch,
		cancelPendingSearchNavigation,
		navigateTo,
		projectFilters,
	]);

	const handleSearchChange = useCallback(
		(query: string) => {
			setSearchQuery(query);
			storeSetSearch(query);
			syncSearchToUrl(query);
		},
		[storeSetSearch, syncSearchToUrl],
	);

	const handleProjectFiltersChange = (projects: string[]) => {
		cancelPendingSearchNavigation();
		storeSetProjectFilters(projects);
		navigateTo(buildSearch({ projects }));
	};

	/** Drives the All / Open / Merged segmented control as one control. */
	const handleStateFilterChange = (next: "open" | "all" | "merged") => {
		cancelPendingSearchNavigation();
		const nextIncludeClosed = next !== "open";
		const nextMergedOnly = next === "merged";
		storeSetIncludeClosed(nextIncludeClosed);
		storeSetMergedOnly(nextMergedOnly);
		navigateTo(
			buildSearch({
				includeClosed: nextIncludeClosed,
				mergedOnly: nextMergedOnly,
			}),
		);
	};

	const handleAuthorFilterChange = (nextAuthor: string | null) => {
		cancelPendingSearchNavigation();
		storeSetAuthorFilter(nextAuthor);
		navigateTo(buildSearch({ author: nextAuthor }));
	};

	const handleReviewFilterChange = (
		nextReview: PullRequestReviewFilter | null,
	) => {
		cancelPendingSearchNavigation();
		storeSetReviewFilter(nextReview);
		navigateTo(buildSearch({ review: nextReview }));
	};

	const stateFilter: "open" | "all" | "merged" = mergedOnly
		? "merged"
		: includeClosed
			? "all"
			: "open";

	if (areIntegrationsReady && pullRequestProviders.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<h2 className="text-base font-medium">
					<Trans>Connect a repository to see pull requests</Trans>
				</h2>
				<p className="max-w-md text-sm text-muted-foreground">
					<Trans>
						Connect a GitHub repository or configure an Azure DevOps project for
						one of your workspaces.
					</Trans>
				</p>
				<Link
					to="/settings/integrations"
					className="rounded-md px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
				>
					<Trans>Open Integrations settings</Trans>
				</Link>
			</div>
		);
	}

	return (
		<div
			data-pull-requests-view
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
		>
			<PullRequestsTopBar
				provider={provider}
				availableProviders={pullRequestProviders}
				onProviderChange={(nextProvider) =>
					navigate({
						to: "/pull-requests",
						search: {
							...buildSearch({}),
							...(nextProvider === "azure-devops"
								? { provider: "azure-devops" as const }
								: {}),
						},
					})
				}
				searchQuery={searchQuery}
				onSearchChange={handleSearchChange}
				projectFilters={projectFilters}
				onProjectFiltersChange={handleProjectFiltersChange}
				projectTargets={providerTargets}
				allowedProjectIds={allowedProjectIds}
				authorFilter={authorFilter}
				onAuthorFilterChange={handleAuthorFilterChange}
				reviewFilter={reviewFilter}
				onReviewFilterChange={handleReviewFilterChange}
				stateFilter={stateFilter}
				onStateFilterChange={handleStateFilterChange}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{provider === "azure-devops" ? (
					<AzurePullRequestsContent
						projectTargets={providerTargets}
						searchQuery={searchQuery}
						includeClosed={includeClosed}
					/>
				) : (
					<PullRequestsContent
						projectFilters={projectFilters}
						projectTargets={providerTargets}
						areProjectsReady={areProjectsReady}
						hasProjects={projects.length > 0}
						searchQuery={searchQuery}
						authorFilter={authorFilter}
						reviewFilter={reviewFilter}
						includeClosed={includeClosed}
						mergedOnly={mergedOnly}
						selectedPrNumber={selectedPrNumber}
						selectedPrProjectId={selectedPrProjectId}
						repoSlugByProjectId={repoSlugByProjectId}
					/>
				)}
			</div>
		</div>
	);
}
