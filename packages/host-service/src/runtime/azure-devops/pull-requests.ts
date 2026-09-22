import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { GitClient } from "../../trpc/router/workspace-creation/shared/types";
import type { ExecAz } from "./exec-az";

const identitySchema = z.object({
	displayName: z.string(),
	uniqueName: z.string().nullable().optional(),
	imageUrl: z.string().nullable().optional(),
});

const repositorySchema = z.object({
	id: z.string(),
	name: z.string(),
	webUrl: z.url().nullish(),
	project: z.object({ id: z.string(), name: z.string() }),
});

const pullRequestSchema = z.object({
	pullRequestId: z.number(),
	title: z.string(),
	description: z.string().nullable().optional(),
	status: z.string(),
	isDraft: z.boolean().optional().default(false),
	creationDate: z.string().optional(),
	closedDate: z.string().nullable().optional(),
	sourceRefName: z.string(),
	targetRefName: z.string(),
	createdBy: identitySchema,
	reviewers: z
		.array(identitySchema.extend({ vote: z.number().optional() }))
		.optional(),
	repository: repositorySchema,
	lastMergeSourceCommit: z
		.object({ commitId: z.string() })
		.nullable()
		.optional(),
	lastMergeTargetCommit: z
		.object({ commitId: z.string() })
		.nullable()
		.optional(),
});

const pullRequestsSchema = z.array(pullRequestSchema);

const policySchema = z.object({
	id: z.number().optional(),
	status: z.string(),
	configuration: z
		.object({
			type: z.object({ displayName: z.string().optional() }).optional(),
		})
		.optional(),
});

const policiesSchema = z.array(policySchema);

const threadSchema = z.object({
	id: z.number(),
	status: z.string().optional(),
	threadContext: z
		.object({
			filePath: z.string().optional(),
			rightFileStart: z
				.object({ line: z.number(), offset: z.number() })
				.nullable()
				.optional(),
			rightFileEnd: z
				.object({ line: z.number(), offset: z.number() })
				.nullable()
				.optional(),
		})
		.nullable()
		.optional(),
	comments: z
		.array(
			z.object({
				id: z.number(),
				parentCommentId: z.number().optional(),
				content: z.string(),
				publishedDate: z.string().optional(),
				author: identitySchema.optional(),
				isDeleted: z.boolean().optional(),
			}),
		)
		.optional(),
});

const threadsResponseSchema = z.union([
	z.array(threadSchema),
	z.object({ value: z.array(threadSchema) }).transform((value) => value.value),
]);

export type AzureDevOpsRepositoryConfig = {
	organizationUrl: string;
	azureProject: string;
	repository: string;
};

function shortRef(ref: string): string {
	return ref.replace(/^refs\/heads\//, "");
}

function pullRequestUrl(
	data: z.infer<typeof pullRequestSchema>,
	config: AzureDevOpsRepositoryConfig,
): string {
	const repositoryUrl =
		data.repository.webUrl ??
		`${config.organizationUrl}/${encodeURIComponent(data.repository.project.name)}/_git/${encodeURIComponent(data.repository.name)}`;
	return `${repositoryUrl.replace(/\/+$/, "")}/pullrequest/${data.pullRequestId}`;
}

function mapState(status: string): "open" | "closed" | "merged" {
	if (status.toLowerCase() === "completed") return "merged";
	if (status.toLowerCase() === "abandoned") return "closed";
	return "open";
}

export async function listAzureDevOpsPullRequests(
	execAz: ExecAz,
	config: AzureDevOpsRepositoryConfig,
	options: { includeClosed: boolean; top: number },
) {
	const rows = pullRequestsSchema.parse(
		await execAz([
			"repos",
			"pr",
			"list",
			"--organization",
			config.organizationUrl,
			"--project",
			config.azureProject,
			"--repository",
			config.repository,
			"--status",
			options.includeClosed ? "all" : "active",
			"--top",
			String(options.top),
			"--include-links",
			"--detect",
			"false",
		]),
	);
	return rows.map((row) => ({
		number: row.pullRequestId,
		title: row.title,
		body: row.description ?? "",
		url: pullRequestUrl(row, config),
		state: mapState(row.status),
		isDraft: row.isDraft,
		branch: shortRef(row.sourceRefName),
		baseBranch: shortRef(row.targetRefName),
		author: row.createdBy.displayName,
		authorAvatarUrl: row.createdBy.imageUrl ?? null,
		createdAt: row.creationDate ?? null,
		updatedAt: row.closedDate ?? row.creationDate ?? null,
		repositoryId: row.repository.id,
		repositoryName: row.repository.name,
		repositoryProjectId: row.repository.project.id,
		repositoryProjectName: row.repository.project.name,
	}));
}

export async function getAzureDevOpsPullRequest(
	execAz: ExecAz,
	config: AzureDevOpsRepositoryConfig,
	pullRequestId: number,
) {
	const row = pullRequestSchema.parse(
		await execAz([
			"repos",
			"pr",
			"show",
			"--id",
			String(pullRequestId),
			"--organization",
			config.organizationUrl,
			"--detect",
			"false",
		]),
	);
	let policies: z.infer<typeof policiesSchema> = [];
	try {
		policies = policiesSchema.parse(
			await execAz([
				"repos",
				"pr",
				"policy",
				"list",
				"--id",
				String(pullRequestId),
				"--organization",
				config.organizationUrl,
				"--detect",
				"false",
			]),
		);
	} catch {
		policies = [];
	}
	const checks = policies.map((policy) => {
		const normalized = policy.status.toLowerCase();
		const status = ["approved", "succeeded", "completed"].includes(normalized)
			? "success"
			: ["rejected", "failed", "broken"].includes(normalized)
				? "failure"
				: "pending";
		return {
			name: policy.configuration?.type?.displayName ?? "Azure policy",
			status,
			url: null,
		};
	});
	return {
		number: row.pullRequestId,
		title: row.title,
		body: row.description ?? "",
		url: pullRequestUrl(row, config),
		state: mapState(row.status),
		branch: shortRef(row.sourceRefName),
		baseBranch: shortRef(row.targetRefName),
		headRepositoryOwner: null,
		isCrossRepository: false,
		author: row.createdBy.displayName,
		isDraft: row.isDraft,
		createdAt: row.creationDate,
		updatedAt: row.closedDate ?? row.creationDate,
		checks,
		checksStatus: checks.some((check) => check.status === "failure")
			? "failure"
			: checks.some((check) => check.status === "pending")
				? "pending"
				: checks.length > 0
					? "success"
					: "none",
		reviewers: (row.reviewers ?? []).map((reviewer) => ({
			name: reviewer.displayName,
			avatarUrl: reviewer.imageUrl ?? null,
			vote: reviewer.vote ?? 0,
		})),
		repository: row.repository,
		sourceCommit: row.lastMergeSourceCommit?.commitId ?? null,
		targetCommit: row.lastMergeTargetCommit?.commitId ?? null,
	};
}

export async function getAzureDevOpsPullRequestDiff(
	execAz: ExecAz,
	git: GitClient,
	remoteName: string,
	config: AzureDevOpsRepositoryConfig,
	pullRequestId: number,
): Promise<string> {
	const row = pullRequestSchema.parse(
		await execAz([
			"repos",
			"pr",
			"show",
			"--id",
			String(pullRequestId),
			"--organization",
			config.organizationUrl,
			"--detect",
			"false",
		]),
	);
	const sourceCommit = row.lastMergeSourceCommit?.commitId;
	const targetCommit = row.lastMergeTargetCommit?.commitId;
	if (!sourceCommit || !targetCommit) return "";
	await git
		.raw([
			"fetch",
			"--no-tags",
			remoteName,
			row.sourceRefName,
			row.targetRefName,
		])
		.catch(() => undefined);
	return git.raw([
		"diff",
		"--no-ext-diff",
		"--binary",
		`${targetCommit}...${sourceCommit}`,
	]);
}

export async function createAzureDevOpsPullRequest(
	execAz: ExecAz,
	config: AzureDevOpsRepositoryConfig,
	input: {
		title: string;
		body?: string;
		sourceBranch: string;
		targetBranch?: string;
		workItemId: number;
		draft: boolean;
	},
) {
	const args = [
		"repos",
		"pr",
		"create",
		"--organization",
		config.organizationUrl,
		"--project",
		config.azureProject,
		"--repository",
		config.repository,
		"--source-branch",
		input.sourceBranch,
		"--title",
		input.title,
		"--draft",
		String(input.draft),
		"--work-items",
		String(input.workItemId),
		"--detect",
		"false",
	];
	if (input.targetBranch) args.push("--target-branch", input.targetBranch);
	if (input.body) args.push("--description", input.body);
	const created = pullRequestSchema.parse(await execAz(args));
	return {
		number: created.pullRequestId,
		url: pullRequestUrl(created, config),
	};
}

async function writeInvokeBody(body: unknown): Promise<{
	path: string;
	cleanup: () => Promise<void>;
}> {
	const directory = await mkdtemp(join(tmpdir(), "superset-azure-invoke-"));
	const path = join(directory, "body.json");
	await writeFile(path, JSON.stringify(body), { mode: 0o600 });
	return {
		path,
		cleanup: () => rm(directory, { recursive: true, force: true }),
	};
}

export async function listAzureDevOpsPullRequestThreads(
	execAz: ExecAz,
	config: AzureDevOpsRepositoryConfig,
	pullRequestId: number,
) {
	const detail = await getAzureDevOpsPullRequest(execAz, config, pullRequestId);
	const threads = threadsResponseSchema.parse(
		await execAz([
			"devops",
			"invoke",
			"--organization",
			config.organizationUrl,
			"--area",
			"git",
			"--resource",
			"pullRequestThreads",
			"--route-parameters",
			`project=${detail.repository.project.id}`,
			`repositoryId=${detail.repository.id}`,
			`pullRequestId=${pullRequestId}`,
			"--api-version",
			"7.1",
			"--http-method",
			"GET",
		]),
	);
	return threads.map((thread) => ({
		id: thread.id,
		status: thread.status ?? "active",
		filePath: thread.threadContext?.filePath ?? null,
		line: thread.threadContext?.rightFileStart?.line ?? null,
		comments: (thread.comments ?? [])
			.filter((comment) => !comment.isDeleted)
			.map((comment) => ({
				id: comment.id,
				parentCommentId: comment.parentCommentId ?? 0,
				body: comment.content,
				author: comment.author?.displayName ?? "Unknown",
				createdAt: comment.publishedDate ?? null,
			})),
	}));
}

export async function replyToAzureDevOpsPullRequestThread(
	execAz: ExecAz,
	config: AzureDevOpsRepositoryConfig,
	input: { pullRequestId: number; threadId: number; body: string },
) {
	const detail = await getAzureDevOpsPullRequest(
		execAz,
		config,
		input.pullRequestId,
	);
	const request = await writeInvokeBody({
		content: input.body,
		parentCommentId: 0,
		commentType: 1,
	});
	try {
		return await execAz([
			"devops",
			"invoke",
			"--organization",
			config.organizationUrl,
			"--area",
			"git",
			"--resource",
			"pullRequestThreadComments",
			"--route-parameters",
			`project=${detail.repository.project.id}`,
			`repositoryId=${detail.repository.id}`,
			`pullRequestId=${input.pullRequestId}`,
			`threadId=${input.threadId}`,
			"--api-version",
			"7.1",
			"--http-method",
			"POST",
			"--media-type",
			"application/json",
			"--in-file",
			request.path,
		]);
	} finally {
		await request.cleanup();
	}
}

export async function setAzureDevOpsPullRequestThreadStatus(
	execAz: ExecAz,
	config: AzureDevOpsRepositoryConfig,
	input: { pullRequestId: number; threadId: number; resolved: boolean },
) {
	const detail = await getAzureDevOpsPullRequest(
		execAz,
		config,
		input.pullRequestId,
	);
	const request = await writeInvokeBody({
		status: input.resolved ? "fixed" : "active",
	});
	try {
		return await execAz([
			"devops",
			"invoke",
			"--organization",
			config.organizationUrl,
			"--area",
			"git",
			"--resource",
			"pullRequestThreads",
			"--route-parameters",
			`project=${detail.repository.project.id}`,
			`repositoryId=${detail.repository.id}`,
			`pullRequestId=${input.pullRequestId}`,
			`threadId=${input.threadId}`,
			"--api-version",
			"7.1",
			"--http-method",
			"PATCH",
			"--media-type",
			"application/json",
			"--in-file",
			request.path,
		]);
	} finally {
		await request.cleanup();
	}
}
