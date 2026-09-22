import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
	type AzureDevOpsWorkItemStage,
	azureDevOpsBoardConfigs,
	azureDevOpsBuildConfigs,
	azureDevOpsProjectConfigs,
	azureDevOpsWorkItemStates,
	projects,
	pullRequests,
	workspacePullRequests,
	workspaces,
} from "../../../db/schema";
import { triggerBitriseBuild } from "../../../runtime/azure-devops/bitrise";
import {
	type AzureDevOpsBoardConfig,
	type AzureDevOpsWorkItemClaim,
	createAzureDevOpsImplementationChild,
	getAzureDevOpsWorkItem,
	getAzureDevOpsWorkItemClaim,
	listAzureDevOpsBoardItems,
	listAzureDevOpsIterations,
} from "../../../runtime/azure-devops/board";
import {
	type AzureDevOpsDiagnostic,
	diagnoseAzureDevOpsProject,
} from "../../../runtime/azure-devops/diagnostics";
import { execAz } from "../../../runtime/azure-devops/exec-az";
import {
	createAzureDevOpsPullRequest,
	getAzureDevOpsPullRequest,
	getAzureDevOpsPullRequestDiff,
	listAzureDevOpsPullRequests,
	listAzureDevOpsPullRequestThreads,
	replyToAzureDevOpsPullRequestThread,
	setAzureDevOpsPullRequestThreadStatus,
} from "../../../runtime/azure-devops/pull-requests";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, queryProcedure, router } from "../../index";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export function normalizeAzureDevOpsOrganizationUrl(value: string): string {
	const url = new URL(value.trim());
	const pathSegments = url.pathname.split("/").filter(Boolean);
	const organization = pathSegments[0];
	if (
		url.protocol !== "https:" ||
		url.hostname.toLowerCase() !== "dev.azure.com" ||
		url.port !== "" ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== "" ||
		pathSegments.length !== 1 ||
		!organization ||
		!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(organization)
	) {
		throw new Error(
			"Organization URL must match https://dev.azure.com/organization",
		);
	}
	return `https://dev.azure.com/${organization}`;
}

function isAzureDevOpsOrganizationUrl(value: string): boolean {
	try {
		normalizeAzureDevOpsOrganizationUrl(value);
		return true;
	} catch {
		return false;
	}
}

const organizationUrlSchema = z
	.string()
	.trim()
	.max(2048)
	.refine(isAzureDevOpsOrganizationUrl, {
		message: "Organization URL must match https://dev.azure.com/organization",
	})
	.transform(normalizeAzureDevOpsOrganizationUrl);

const azureIdentifierSchema = z.string().trim().min(1).max(256);
const workItemStageSchema = z.enum([
	"implementation",
	"homologation",
	"review",
]);

const setProjectConfigSchema = projectIdSchema.extend({
	organizationUrl: organizationUrlSchema,
	azureProject: azureIdentifierSchema,
	repository: azureIdentifierSchema,
});

const buildPlatformSchema = z.enum(["android", "ios"]);
const buildLaneSchema = z.enum(["alpha", "beta", "release"]);
const buildDeveloperNamesSchema = z
	.array(z.string().trim().min(1).max(120))
	.max(100)
	.refine(
		(names) =>
			new Set(names.map((name) => name.toLocaleLowerCase("en-US"))).size ===
			names.length,
		{ message: "Developer names must be unique" },
	);

const setBuildConfigSchema = projectIdSchema.extend({
	platform: buildPlatformSchema,
	developerNames: buildDeveloperNamesSchema,
	alphaVersionValue: z.string().trim().max(80),
	bitriseToken: z.string().trim().min(1).max(4096).optional(),
});

const buildVersionSchema = z.string().trim().min(1).max(80);

const setBoardConfigSchema = z.object({
	organizationUrl: organizationUrlSchema,
	workItemProject: azureIdentifierSchema,
	team: azureIdentifierSchema,
	areaPath: z
		.string()
		.trim()
		.transform((areaPath) => areaPath.replace(/^\\+/, "").replaceAll("/", "\\"))
		.pipe(z.string().min(1).max(512)),
	assignedTo: z.string().trim().min(1).max(320).nullable().optional(),
	workItemTypes: z
		.array(azureIdentifierSchema)
		.min(1)
		.max(10)
		.default(["Bug", "User Story"]),
});

function requireProject(ctx: HostServiceContext, projectId: string) {
	const project = ctx.db.query.projects
		.findFirst({ where: eq(projects.id, projectId) })
		.sync();
	if (!project) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Project is not set up on this host",
		});
	}
	return project;
}

function getProjectConfig(ctx: HostServiceContext, projectId: string) {
	return ctx.db.query.azureDevOpsProjectConfigs
		.findFirst({
			where: eq(azureDevOpsProjectConfigs.projectId, projectId),
		})
		.sync();
}

function getBuildConfig(ctx: HostServiceContext, projectId: string) {
	return ctx.db.query.azureDevOpsBuildConfigs
		.findFirst({
			where: eq(azureDevOpsBuildConfigs.projectId, projectId),
		})
		.sync();
}

function bitriseCredentialKey(
	organizationId: string,
	projectId: string,
	platform: "android" | "ios",
): string {
	return `${organizationId}:${projectId}:${platform}`;
}

function requireBitriseCredentialStore(ctx: HostServiceContext) {
	if (!ctx.bitriseCredentialStore) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "The host credential store is unavailable",
		});
	}
	return ctx.bitriseCredentialStore;
}

function toBuildConfig(
	row: NonNullable<ReturnType<typeof getBuildConfig>>,
	tokenConfigured: boolean,
) {
	return {
		projectId: row.projectId,
		platform: row.platform,
		developerNames: parseDeveloperNames(row.developerNamesJson),
		alphaVersionValue: row.alphaVersionValue,
		bitriseTokenConfigured: tokenConfigured,
	};
}

function parseDeveloperNames(value: string): string[] {
	try {
		return buildDeveloperNamesSchema.parse(JSON.parse(value));
	} catch {
		return [];
	}
}

async function readBitriseToken(
	ctx: HostServiceContext,
	projectId: string,
	platform: "android" | "ios",
): Promise<string | undefined> {
	try {
		return await requireBitriseCredentialStore(ctx).get(
			bitriseCredentialKey(ctx.organizationId, projectId, platform),
		);
	} catch {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "The host credential store is unavailable",
		});
	}
}

function toProjectConfig(row: typeof azureDevOpsProjectConfigs.$inferSelect) {
	return {
		projectId: row.projectId,
		organizationUrl: row.organizationUrl,
		azureProject: row.azureProject,
		repository: row.repository,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function requireAzureProjectConfig(ctx: HostServiceContext, projectId: string) {
	const project = requireProject(ctx, projectId);
	const config = getProjectConfig(ctx, projectId);
	if (!config) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Azure DevOps is not configured for this project",
		});
	}
	return { project, config: toProjectConfig(config) };
}

function getBoardConfigRow(ctx: HostServiceContext) {
	return ctx.db.query.azureDevOpsBoardConfigs
		.findFirst({ where: eq(azureDevOpsBoardConfigs.id, 1) })
		.sync();
}

function parseWorkItemTypes(value: string): string[] {
	try {
		const parsed = z.array(z.string().min(1)).safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : ["Bug", "User Story"];
	} catch {
		return ["Bug", "User Story"];
	}
}

function toBoardConfig(
	row: typeof azureDevOpsBoardConfigs.$inferSelect,
): AzureDevOpsBoardConfig {
	return {
		organizationUrl: row.organizationUrl,
		workItemProject: row.workItemProject,
		team: row.team,
		areaPath: row.areaPath,
		assignedTo: row.assignedTo,
		workItemTypes: parseWorkItemTypes(row.workItemTypesJson),
	};
}

function requireBoardConfig(ctx: HostServiceContext): AzureDevOpsBoardConfig {
	const row = getBoardConfigRow(ctx);
	if (!row) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Azure DevOps board is not configured on this host",
		});
	}
	return toBoardConfig(row);
}

function upsertWorkItemStage(
	ctx: HostServiceContext,
	workItemId: number,
	stage: AzureDevOpsWorkItemStage,
	childWorkItemId?: number | null,
) {
	const now = Date.now();
	ctx.db
		.insert(azureDevOpsWorkItemStates)
		.values({
			workItemId,
			stage,
			childWorkItemId: childWorkItemId ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: azureDevOpsWorkItemStates.workItemId,
			set: {
				stage,
				...(childWorkItemId !== undefined ? { childWorkItemId } : {}),
				updatedAt: now,
			},
		})
		.run();
}

const claimInFlight = new Map<number, Promise<{ childWorkItemId: number }>>();

const ALLOWED_STAGE_MOVES = new Set([
	"implementation:homologation",
	"homologation:implementation",
	"homologation:review",
	"review:homologation",
]);

type ReadWorkItemClaim = (
	workItemId: number,
) => Promise<AzureDevOpsWorkItemClaim>;

export async function applyWorkItemStage(
	ctx: HostServiceContext,
	input: { workItemId: number; stage: AzureDevOpsWorkItemStage },
	readRemoteClaim?: ReadWorkItemClaim,
) {
	const storedState = ctx.db.query.azureDevOpsWorkItemStates
		.findFirst({
			where: eq(azureDevOpsWorkItemStates.workItemId, input.workItemId),
		})
		.sync();
	let current: {
		stage: AzureDevOpsWorkItemStage;
		childWorkItemId: number | null;
	} | null = storedState
		? {
				stage: storedState.stage,
				childWorkItemId: storedState.childWorkItemId,
			}
		: null;

	if (!current) {
		const remoteState = await (
			readRemoteClaim ??
			((workItemId) =>
				getAzureDevOpsWorkItemClaim(
					execAz,
					requireBoardConfig(ctx),
					workItemId,
				))
		)(input.workItemId);
		if (!remoteState.claim?.isCurrentUser) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Claim the work item before changing its stage",
			});
		}
		current = {
			stage: "implementation",
			childWorkItemId: remoteState.claim.childId,
		};
	}

	if (
		current.stage !== input.stage &&
		!ALLOWED_STAGE_MOVES.has(`${current.stage}:${input.stage}`)
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Work items can only move between adjacent stages",
		});
	}

	upsertWorkItemStage(
		ctx,
		input.workItemId,
		input.stage,
		current.childWorkItemId,
	);
	return { stage: input.stage };
}

const notConfiguredDiagnostic: AzureDevOpsDiagnostic = {
	status: "not_configured",
	cliVersion: null,
	extensionVersion: null,
	repository: null,
};

export const azureDevOpsRouter = router({
	getBoardConfig: protectedProcedure.query(({ ctx }) => {
		const row = getBoardConfigRow(ctx);
		return row ? toBoardConfig(row) : null;
	}),

	setBoardConfig: protectedProcedure
		.input(setBoardConfigSchema)
		.mutation(({ ctx, input }) => {
			const now = Date.now();
			ctx.db
				.insert(azureDevOpsBoardConfigs)
				.values({
					id: 1,
					organizationUrl: input.organizationUrl,
					workItemProject: input.workItemProject,
					team: input.team,
					areaPath: input.areaPath,
					assignedTo: input.assignedTo ?? null,
					workItemTypesJson: JSON.stringify(input.workItemTypes),
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: azureDevOpsBoardConfigs.id,
					set: {
						organizationUrl: input.organizationUrl,
						workItemProject: input.workItemProject,
						team: input.team,
						areaPath: input.areaPath,
						assignedTo: input.assignedTo ?? null,
						workItemTypesJson: JSON.stringify(input.workItemTypes),
						updatedAt: now,
					},
				})
				.run();
			return requireBoardConfig(ctx);
		}),

	removeBoardConfig: protectedProcedure.mutation(({ ctx }) => {
		ctx.db
			.delete(azureDevOpsBoardConfigs)
			.where(eq(azureDevOpsBoardConfigs.id, 1))
			.run();
		return { ok: true as const };
	}),

	listIterations: queryProcedure
		.meta({ timeoutMs: 60_000 })
		.query(({ ctx }) =>
			listAzureDevOpsIterations(execAz, requireBoardConfig(ctx)),
		),

	listBoard: queryProcedure
		.meta({ timeoutMs: 60_000 })
		.input(
			z.object({
				iterationPath: z.string().min(1).max(512).optional(),
				includeClaimed: z.boolean().default(false),
			}),
		)
		.query(async ({ ctx, input }) => {
			const config = requireBoardConfig(ctx);
			const iterations = await listAzureDevOpsIterations(execAz, config);
			const iterationPath =
				input.iterationPath ??
				iterations.find((iteration) => iteration.isCurrent)?.path ??
				iterations[0]?.path;
			if (!iterationPath) {
				return {
					items: [],
					iterations,
					iterationPath: null,
					currentUser: null,
				};
			}
			const board = await listAzureDevOpsBoardItems(
				execAz,
				config,
				iterationPath,
			);
			const localStates = new Map(
				ctx.db
					.select()
					.from(azureDevOpsWorkItemStates)
					.all()
					.map((row) => [row.workItemId, row]),
			);
			const items = board.items
				.filter(
					(item) =>
						input.includeClaimed || !item.claim || item.claim.isCurrentUser,
				)
				.map((item) => {
					const local = localStates.get(item.id);
					const stage: AzureDevOpsWorkItemStage | "backlog" =
						local?.stage ?? (item.claim ? "implementation" : "backlog");
					return {
						...item,
						stage,
						childWorkItemId:
							local?.childWorkItemId ?? item.claim?.childId ?? null,
					};
				});
			return {
				items,
				iterations,
				iterationPath,
				currentUser: board.currentUser,
			};
		}),

	getWorkItem: queryProcedure
		.meta({ timeoutMs: 60_000 })
		.input(z.object({ workItemId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const config = requireBoardConfig(ctx);
			const item = await getAzureDevOpsWorkItem(
				execAz,
				config,
				input.workItemId,
			);
			const localState = ctx.db.query.azureDevOpsWorkItemStates
				.findFirst({
					where: eq(azureDevOpsWorkItemStates.workItemId, input.workItemId),
				})
				.sync();
			return {
				item,
				stage: localState?.stage ?? null,
				childWorkItemId: localState?.childWorkItemId ?? null,
				webUrl: `${config.organizationUrl}/${encodeURIComponent(config.workItemProject)}/_workitems/edit/${input.workItemId}`,
			};
		}),

	getWorkItemClaim: queryProcedure
		.meta({ timeoutMs: 60_000 })
		.input(z.object({ workItemId: z.number().int().positive() }))
		.query(async ({ ctx, input }) => {
			const config = requireBoardConfig(ctx);
			const localState = ctx.db.query.azureDevOpsWorkItemStates
				.findFirst({
					where: eq(azureDevOpsWorkItemStates.workItemId, input.workItemId),
				})
				.sync();
			const remoteState = await getAzureDevOpsWorkItemClaim(
				execAz,
				config,
				input.workItemId,
			);
			return {
				stage:
					localState?.stage ??
					(localState?.childWorkItemId ? "implementation" : remoteState.stage),
				childWorkItemId:
					localState?.childWorkItemId ?? remoteState.claim?.childId ?? null,
				claim: remoteState.claim,
			};
		}),

	claimWorkItem: protectedProcedure
		.input(
			z.object({
				workItemId: z.number().int().positive(),
				iterationPath: z.string().min(1).max(512),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = claimInFlight.get(input.workItemId);
			if (existing) return existing;
			const promise = (async () => {
				const config = requireBoardConfig(ctx);
				const board = await listAzureDevOpsBoardItems(
					execAz,
					config,
					input.iterationPath,
				);
				const item = board.items.find(
					(candidate) => candidate.id === input.workItemId,
				);
				if (!item) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Work item not found",
					});
				}
				if (item.claim && !item.claim.isCurrentUser) {
					throw new TRPCError({
						code: "CONFLICT",
						message: item.claim.assignedTo?.displayName
							? `Work item is already claimed by ${item.claim.assignedTo.displayName}`
							: "Work item is already claimed",
					});
				}
				const assignedTo = board.currentUser ?? config.assignedTo;
				if (!assignedTo) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Azure DevOps user identity could not be determined",
					});
				}
				const childWorkItemId =
					item.claim?.childId ??
					(await createAzureDevOpsImplementationChild(
						execAz,
						config,
						item,
						assignedTo,
					));
				upsertWorkItemStage(
					ctx,
					input.workItemId,
					"implementation",
					childWorkItemId,
				);
				return { childWorkItemId };
			})();
			claimInFlight.set(input.workItemId, promise);
			try {
				return await promise;
			} finally {
				claimInFlight.delete(input.workItemId);
			}
		}),

	setWorkItemStage: protectedProcedure
		.input(
			z.object({
				workItemId: z.number().int().positive(),
				stage: workItemStageSchema,
			}),
		)
		.mutation(({ ctx, input }) => applyWorkItemStage(ctx, input)),

	listPullRequests: queryProcedure
		.meta({ timeoutMs: 45_000 })
		.input(
			z.object({
				projectId: z.string().uuid(),
				includeClosed: z.boolean().default(false),
				page: z.number().int().positive().default(1),
				limit: z.number().int().min(1).max(100).default(30),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { config } = requireAzureProjectConfig(ctx, input.projectId);
			const requestedCount = input.page * input.limit;
			const items = await listAzureDevOpsPullRequests(execAz, config, {
				includeClosed: input.includeClosed,
				top: requestedCount + 1,
			});
			const offset = (input.page - 1) * input.limit;
			const pageItems = items.slice(offset, requestedCount);
			return {
				items: pageItems.map((item) => ({
					...item,
					projectId: input.projectId,
				})),
				hasNextPage: items.length > requestedCount,
				totalCount: Math.min(items.length, requestedCount),
			};
		}),

	getPullRequest: queryProcedure
		.meta({ timeoutMs: 45_000 })
		.input(
			z.object({
				projectId: z.string().uuid(),
				pullRequestId: z.number().int().positive(),
			}),
		)
		.query(({ ctx, input }) => {
			const { config } = requireAzureProjectConfig(ctx, input.projectId);
			return getAzureDevOpsPullRequest(execAz, config, input.pullRequestId);
		}),

	getPullRequestDiff: queryProcedure
		.meta({ timeoutMs: 60_000 })
		.input(
			z.object({
				projectId: z.string().uuid(),
				pullRequestId: z.number().int().positive(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { project, config } = requireAzureProjectConfig(
				ctx,
				input.projectId,
			);
			const git = await ctx.git(project.repoPath);
			const patch = await getAzureDevOpsPullRequestDiff(
				execAz,
				git,
				project.remoteName ?? "origin",
				config,
				input.pullRequestId,
			);
			return { patch };
		}),

	getPullRequestThreads: queryProcedure
		.meta({ timeoutMs: 45_000 })
		.input(
			z.object({
				projectId: z.string().uuid(),
				pullRequestId: z.number().int().positive(),
			}),
		)
		.query(({ ctx, input }) => {
			const { config } = requireAzureProjectConfig(ctx, input.projectId);
			return listAzureDevOpsPullRequestThreads(
				execAz,
				config,
				input.pullRequestId,
			);
		}),

	replyToPullRequestThread: protectedProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				pullRequestId: z.number().int().positive(),
				threadId: z.number().int().positive(),
				body: z.string().trim().min(1).max(4000),
			}),
		)
		.mutation(({ ctx, input }) => {
			const { config } = requireAzureProjectConfig(ctx, input.projectId);
			return replyToAzureDevOpsPullRequestThread(execAz, config, input);
		}),

	setPullRequestThreadResolution: protectedProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				pullRequestId: z.number().int().positive(),
				threadId: z.number().int().positive(),
				resolved: z.boolean(),
			}),
		)
		.mutation(({ ctx, input }) => {
			const { config } = requireAzureProjectConfig(ctx, input.projectId);
			return setAzureDevOpsPullRequestThreadStatus(execAz, config, input);
		}),

	createPullRequest: protectedProcedure
		.input(
			z.object({
				workspaceId: z.string().uuid(),
				workItemId: z.number().int().positive(),
				title: z.string().trim().min(1).max(400),
				body: z.string().max(4000).optional(),
				targetBranch: z.string().trim().min(1).optional(),
				draft: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const workspace = ctx.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, input.workspaceId) })
				.sync();
			if (!workspace?.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			}
			if (
				workspace.externalWorkItemProvider !== "azure-devops" ||
				workspace.externalWorkItemId !== String(input.workItemId)
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Workspace is not linked to this Azure work item",
				});
			}
			const { config } = requireAzureProjectConfig(ctx, workspace.projectId);
			const created = await createAzureDevOpsPullRequest(execAz, config, {
				title: input.title,
				body: input.body,
				sourceBranch: workspace.branch,
				targetBranch: input.targetBranch,
				workItemId: input.workItemId,
				draft: input.draft,
			});
			const detail = await getAzureDevOpsPullRequest(
				execAz,
				config,
				created.number,
			);
			const owner =
				new URL(config.organizationUrl).pathname
					.split("/")
					.filter(Boolean)[0] ?? "azure";
			const existing = ctx.db.query.pullRequests
				.findFirst({
					where: and(
						eq(pullRequests.repoProvider, "azure-devops"),
						eq(pullRequests.repoOwner, owner),
						eq(pullRequests.repoProject, config.azureProject),
						eq(pullRequests.repoName, config.repository),
						eq(pullRequests.prNumber, created.number),
					),
				})
				.sync();
			const pullRequestId = existing?.id ?? randomUUID();
			const now = Date.now();
			ctx.db
				.insert(pullRequests)
				.values({
					id: pullRequestId,
					projectId: workspace.projectId,
					repoProvider: "azure-devops",
					repoOwner: owner,
					repoProject: config.azureProject,
					repoName: config.repository,
					prNumber: created.number,
					url: created.url,
					title: detail.title,
					state: detail.state,
					isDraft: detail.isDraft,
					headBranch: detail.branch,
					headSha: detail.sourceCommit ?? "",
					reviewDecision: null,
					checksStatus: detail.checksStatus,
					checksJson: JSON.stringify(detail.checks),
					lastFetchedAt: now,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [
						pullRequests.repoProvider,
						pullRequests.repoOwner,
						pullRequests.repoProject,
						pullRequests.repoName,
						pullRequests.prNumber,
					],
					set: {
						title: detail.title,
						state: detail.state,
						checksStatus: detail.checksStatus,
						checksJson: JSON.stringify(detail.checks),
						updatedAt: now,
					},
				})
				.run();
			ctx.db
				.update(workspaces)
				.set({ pullRequestId, updatedAt: now })
				.where(eq(workspaces.id, workspace.id))
				.run();
			ctx.db
				.insert(workspacePullRequests)
				.values({ workspaceId: workspace.id, pullRequestId, linkedAt: now })
				.onConflictDoNothing()
				.run();
			return created;
		}),

	getProjectConfig: protectedProcedure
		.input(projectIdSchema)
		.query(({ ctx, input }) => {
			requireProject(ctx, input.projectId);
			const config = getProjectConfig(ctx, input.projectId);
			return config ? toProjectConfig(config) : null;
		}),

	setProjectConfig: protectedProcedure
		.input(setProjectConfigSchema)
		.mutation(({ ctx, input }) => {
			requireProject(ctx, input.projectId);
			const now = Date.now();
			ctx.db
				.insert(azureDevOpsProjectConfigs)
				.values({
					projectId: input.projectId,
					organizationUrl: input.organizationUrl,
					azureProject: input.azureProject,
					repository: input.repository,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: azureDevOpsProjectConfigs.projectId,
					set: {
						organizationUrl: input.organizationUrl,
						azureProject: input.azureProject,
						repository: input.repository,
						updatedAt: now,
					},
				})
				.run();
			const config = getProjectConfig(ctx, input.projectId);
			if (!config) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Azure DevOps configuration could not be saved",
				});
			}
			return toProjectConfig(config);
		}),

	removeProjectConfig: protectedProcedure
		.input(projectIdSchema)
		.mutation(({ ctx, input }) => {
			requireProject(ctx, input.projectId);
			ctx.db
				.delete(azureDevOpsProjectConfigs)
				.where(eq(azureDevOpsProjectConfigs.projectId, input.projectId))
				.run();
			return { ok: true as const };
		}),

	getBuildConfig: protectedProcedure
		.input(projectIdSchema)
		.query(async ({ ctx, input }) => {
			requireProject(ctx, input.projectId);
			const row = getBuildConfig(ctx, input.projectId);
			if (!row) return null;
			const token = await readBitriseToken(ctx, input.projectId, row.platform);
			return toBuildConfig(row, Boolean(token));
		}),

	setBuildConfig: protectedProcedure
		.input(setBuildConfigSchema)
		.mutation(async ({ ctx, input }) => {
			requireProject(ctx, input.projectId);
			if (input.bitriseToken) {
				try {
					await requireBitriseCredentialStore(ctx).set(
						bitriseCredentialKey(
							ctx.organizationId,
							input.projectId,
							input.platform,
						),
						input.bitriseToken,
					);
				} catch {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "The host credential store is unavailable",
					});
				}
			}

			const now = Date.now();
			ctx.db
				.insert(azureDevOpsBuildConfigs)
				.values({
					projectId: input.projectId,
					platform: input.platform,
					developerNamesJson: JSON.stringify(input.developerNames),
					alphaVersionValue: input.alphaVersionValue,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: azureDevOpsBuildConfigs.projectId,
					set: {
						platform: input.platform,
						developerNamesJson: JSON.stringify(input.developerNames),
						alphaVersionValue: input.alphaVersionValue,
						updatedAt: now,
					},
				})
				.run();
			const row = getBuildConfig(ctx, input.projectId);
			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Build configuration could not be saved",
				});
			}
			const token = await readBitriseToken(
				ctx,
				input.projectId,
				input.platform,
			);
			return toBuildConfig(row, Boolean(token));
		}),

	removeBitriseToken: protectedProcedure
		.input(projectIdSchema.extend({ platform: buildPlatformSchema }))
		.mutation(async ({ ctx, input }) => {
			requireProject(ctx, input.projectId);
			try {
				await requireBitriseCredentialStore(ctx).delete(
					bitriseCredentialKey(
						ctx.organizationId,
						input.projectId,
						input.platform,
					),
				);
			} catch {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "The host credential store is unavailable",
				});
			}
			return { ok: true as const };
		}),

	generateBuild: protectedProcedure
		.input(
			z.object({
				workItemId: z.number().int().positive(),
				workspaceId: z.string().uuid(),
				lane: buildLaneSchema,
				developerName: z.string().trim().min(1).max(120),
				versionName: buildVersionSchema.optional(),
				versionNumber: buildVersionSchema.optional(),
				addToMocks: z.boolean().default(false),
			}),
		)
		.meta({ timeoutMs: 35_000 })
		.mutation(async ({ ctx, input }) => {
			const workspace = ctx.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, input.workspaceId) })
				.sync();
			if (!workspace?.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			}
			if (
				workspace.externalWorkItemProvider !== "azure-devops" ||
				workspace.externalWorkItemId !== String(input.workItemId)
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Workspace is not linked to this Azure work item",
				});
			}
			const config = getBuildConfig(ctx, workspace.projectId);
			if (!config) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Build generation is not configured for this project",
				});
			}
			if (
				!parseDeveloperNames(config.developerNamesJson).includes(
					input.developerName,
				)
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Select a developer name configured for this project",
				});
			}
			const osNumber = /\d{4,}/.exec(workspace.branch)?.[0];
			if (!osNumber) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"The workspace branch does not contain a valid work item number",
				});
			}
			if (input.lane !== "alpha" && !input.versionName) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Enter the version name for beta or release builds",
				});
			}
			if (
				config.platform === "android" &&
				input.lane !== "alpha" &&
				!input.versionNumber
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Enter the version number for Android builds",
				});
			}
			const token = await readBitriseToken(
				ctx,
				workspace.projectId,
				config.platform,
			);
			if (!token) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Add the Bitrise token in the project settings before building",
				});
			}
			const result = await triggerBitriseBuild({
				platform: config.platform,
				lane: input.lane,
				token,
				branch: workspace.branch,
				workItemNumber: osNumber,
				developerName: input.developerName,
				alphaVersionValue: config.alphaVersionValue,
				versionName: input.versionName,
				versionNumber: input.versionNumber,
				addToMocks: input.addToMocks,
			});
			return {
				platform: config.platform,
				lane: input.lane,
				branch: workspace.branch,
				workItemNumber: osNumber,
				...result,
			};
		}),

	diagnoseProject: queryProcedure
		.meta({ timeoutMs: 50_000 })
		.input(projectIdSchema)
		.query(async ({ ctx, input }) => {
			const project = requireProject(ctx, input.projectId);
			const config = getProjectConfig(ctx, input.projectId);
			if (!config) return notConfiguredDiagnostic;
			return diagnoseAzureDevOpsProject(
				{
					organizationUrl: config.organizationUrl,
					azureProject: config.azureProject,
					repository: config.repository,
				},
				{ cwd: project.repoPath },
			);
		}),
});
