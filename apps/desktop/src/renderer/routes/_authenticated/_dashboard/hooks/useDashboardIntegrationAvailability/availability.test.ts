import { describe, expect, test } from "bun:test";
import {
	getAvailablePullRequestProviders,
	getAvailableTaskSources,
	resolvePullRequestProvider,
	resolveTaskSource,
	shouldShowPullRequestProviderSwitcher,
	shouldShowTaskSourceSwitcher,
} from "./availability";

describe("task source availability", () => {
	test("returns only connected sources in stable order", () => {
		expect(
			getAvailableTaskSources({
				linear: false,
				github: true,
				azureDevOps: true,
			}),
		).toEqual(["issues", "azure"]);
	});

	test("returns no sources when no integration is configured", () => {
		expect(
			getAvailableTaskSources({
				linear: false,
				github: false,
				azureDevOps: false,
			}),
		).toEqual([]);
	});

	test("falls back from an unavailable task source", () => {
		expect(resolveTaskSource("azure", ["tasks"])).toBe("tasks");
		expect(resolveTaskSource("tasks", [])).toBeNull();
	});

	test("shows the source switcher only with multiple task sources", () => {
		expect(shouldShowTaskSourceSwitcher([])).toBe(false);
		expect(shouldShowTaskSourceSwitcher(["azure"])).toBe(false);
		expect(shouldShowTaskSourceSwitcher(["tasks", "issues"])).toBe(true);
	});
});

describe("pull request provider availability", () => {
	test("requires connected GitHub repositories or configured Azure projects", () => {
		expect(
			getAvailablePullRequestProviders({
				githubRepositoryCount: 0,
				azureProjectCount: 0,
			}),
		).toEqual([]);
		expect(
			getAvailablePullRequestProviders({
				githubRepositoryCount: 2,
				azureProjectCount: 0,
			}),
		).toEqual(["github"]);
		expect(
			getAvailablePullRequestProviders({
				githubRepositoryCount: 1,
				azureProjectCount: 3,
			}),
		).toEqual(["github", "azure-devops"]);
	});

	test("falls back to the available provider when the URL source is stale", () => {
		expect(resolvePullRequestProvider("azure-devops", ["github"])).toBe(
			"github",
		);
		expect(resolvePullRequestProvider("github", ["azure-devops"])).toBe(
			"azure-devops",
		);
		expect(resolvePullRequestProvider("github", [])).toBeNull();
	});

	test("shows the provider switcher only when both providers are available", () => {
		expect(shouldShowPullRequestProviderSwitcher([])).toBe(false);
		expect(shouldShowPullRequestProviderSwitcher(["github"])).toBe(false);
		expect(
			shouldShowPullRequestProviderSwitcher(["github", "azure-devops"]),
		).toBe(true);
	});
});
