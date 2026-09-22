import { describe, expect, test } from "bun:test";
import type { ExecAz } from "./exec-az";
import {
	createAzureDevOpsPullRequest,
	getAzureDevOpsPullRequest,
	listAzureDevOpsPullRequests,
} from "./pull-requests";

const config = {
	organizationUrl: "https://dev.azure.com/acme",
	azureProject: "Mobile",
	repository: "app",
};

function pullRequest(overrides: Record<string, unknown> = {}) {
	return {
		pullRequestId: 42,
		title: "US-123: Fix login",
		description: "Details",
		status: "active",
		isDraft: false,
		creationDate: "2026-09-21T10:00:00Z",
		closedDate: null,
		sourceRefName: "refs/heads/feature/123-login",
		targetRefName: "refs/heads/develop",
		createdBy: { displayName: "Developer" },
		reviewers: [{ displayName: "Reviewer", vote: 10 }],
		repository: {
			id: "repo-id",
			name: "app",
			webUrl: "https://dev.azure.com/acme/Mobile/_git/app",
			project: { id: "project-id", name: "Mobile" },
		},
		lastMergeSourceCommit: { commitId: "source-sha" },
		lastMergeTargetCommit: { commitId: "target-sha" },
		...overrides,
	};
}

describe("Azure DevOps pull requests", () => {
	test("normalizes list rows for the shared pull request UI", async () => {
		const calls: string[][] = [];
		const run: ExecAz = async (args) => {
			calls.push(args);
			return [pullRequest()];
		};
		const rows = await listAzureDevOpsPullRequests(run, config, {
			includeClosed: false,
			top: 30,
		});
		expect(rows[0]).toMatchObject({
			number: 42,
			state: "open",
			branch: "feature/123-login",
			baseBranch: "develop",
			url: "https://dev.azure.com/acme/Mobile/_git/app/pullrequest/42",
		});
		expect(calls[0]).not.toContain("--skip");
	});

	test.each([
		["omitted", undefined],
		["null", null],
	] as const)("builds the PR URL when repository.webUrl is %s", async (_label, webUrl) => {
		const item = pullRequest({
			repository: {
				id: "repo-id",
				name: "app name",
				...(webUrl === undefined ? {} : { webUrl }),
				project: { id: "project-id", name: "Mobile App" },
			},
		});
		const run: ExecAz = async () => [item];

		const rows = await listAzureDevOpsPullRequests(run, config, {
			includeClosed: false,
			top: 30,
		});

		expect(rows[0]?.url).toBe(
			"https://dev.azure.com/acme/Mobile%20App/_git/app%20name/pullrequest/42",
		);
	});

	test("maps Azure policies into check status", async () => {
		let call = 0;
		const run: ExecAz = async () => {
			call++;
			return call === 1
				? pullRequest()
				: [
						{
							status: "approved",
							configuration: {
								type: { displayName: "Required reviewers" },
							},
						},
					];
		};
		const detail = await getAzureDevOpsPullRequest(run, config, 42);
		expect(detail.checksStatus).toBe("success");
		expect(detail.checks).toEqual([
			{ name: "Required reviewers", status: "success", url: null },
		]);
	});

	test("creates a PR linked to the work item", async () => {
		const calls: string[][] = [];
		const run: ExecAz = async (args) => {
			calls.push(args);
			return pullRequest();
		};
		await createAzureDevOpsPullRequest(run, config, {
			title: "US-123: Fix login",
			body: "Details",
			sourceBranch: "feature/123-login",
			targetBranch: "develop",
			workItemId: 123,
			draft: false,
		});
		expect(calls[0]).toContain("--work-items");
		expect(calls[0]).toContain("123");
	});
});
