import type { TaskSource } from "../../tasks/components/TasksView/components/TasksTopBar";

export type PullRequestProvider = "github" | "azure-devops";

export function shouldShowTaskSourceSwitcher(available: TaskSource[]): boolean {
	return available.length > 1;
}

export function shouldShowPullRequestProviderSwitcher(
	available: PullRequestProvider[],
): boolean {
	return available.length > 1;
}

export function getAvailableTaskSources(input: {
	linear: boolean;
	github: boolean;
	azureDevOps: boolean;
}): TaskSource[] {
	return [
		...(input.linear ? (["tasks"] as const) : []),
		...(input.github ? (["issues"] as const) : []),
		...(input.azureDevOps ? (["azure"] as const) : []),
	];
}

export function getAvailablePullRequestProviders(input: {
	githubRepositoryCount: number;
	azureProjectCount: number;
}): PullRequestProvider[] {
	return [
		...(input.githubRepositoryCount > 0 ? (["github"] as const) : []),
		...(input.azureProjectCount > 0 ? (["azure-devops"] as const) : []),
	];
}

export function resolveTaskSource(
	requested: TaskSource,
	available: TaskSource[],
): TaskSource | null {
	return available.includes(requested) ? requested : (available[0] ?? null);
}

export function resolvePullRequestProvider(
	requested: PullRequestProvider,
	available: PullRequestProvider[],
): PullRequestProvider | null {
	return available.includes(requested) ? requested : (available[0] ?? null);
}
