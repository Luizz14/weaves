import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { projects, workspaces } from "../../../db/schema";
import { emitProjectChanged } from "../../../projects/local-project-store";
import {
	cancelIntegration,
	finishIntegration,
	IntegrationError,
	integrationKind,
	pendingConflictPaths,
	readConflict,
	readIntegrationSession,
	resolveConflict,
	startIntegration,
	withIntegrationRepository,
} from "../../../runtime/branch-integration/branch-integration";
import { createGitEnvResolver } from "../../../runtime/git";
import { createUserSimpleGit } from "../../../runtime/git/simple-git";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";
import { getDefaultBranchName } from "../git/utils/git-helpers";
import { gitStatusStore } from "../git/utils/git-status-store";
import { resolveWorktreePath } from "../git/utils/resolve-worktree";

const workspaceInput = z.object({ workspaceId: z.string() });
const sessionInput = workspaceInput.extend({ sessionId: z.string().uuid() });
const settingsInput = z.object({
	projectId: z.string().uuid(),
	mergeTargetBranch: z.string().min(1).max(1024).nullable(),
	updateRemote: z.string().min(1).max(1024).nullable(),
	mergeToMainEnabled: z.boolean(),
	updateFromMainEnabled: z.boolean(),
});
function projectFor(ctx: HostServiceContext, projectId: string) {
	const project = ctx.db
		.select()
		.from(projects)
		.where(eq(projects.id, projectId))
		.get();
	if (!project)
		throw new TRPCError({ code: "NOT_FOUND", message: "PROJECT_MISSING" });
	return project;
}
function workspaceProject(ctx: HostServiceContext, workspaceId: string) {
	const workspace = ctx.db
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.get();
	if (!workspace?.projectId)
		throw new TRPCError({ code: "NOT_FOUND", message: "PROJECT_MISSING" });
	return projectFor(ctx, workspace.projectId);
}
function configuration(project: ReturnType<typeof projectFor>) {
	return {
		mergeTargetBranch: project.mergeTargetBranch,
		updateRemote: project.updateRemote,
		mergeToMainEnabled: project.mergeToMainEnabled,
		updateFromMainEnabled: project.updateFromMainEnabled,
	};
}
async function guarded<T>(
	repoPath: string,
	action: (root: string) => Promise<T>,
	readOnly = false,
) {
	try {
		return await withIntegrationRepository(repoPath, action, readOnly);
	} catch (error) {
		if (error instanceof TRPCError) throw error;
		if (error instanceof IntegrationError)
			throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.code });
		console.error("[branch-integration] Git operation failed", error);
		throw new TRPCError({ code: "PRECONDITION_FAILED", message: "GIT_FAILED" });
	}
}
async function requireSession(
	root: string,
	projectId: string,
	input: z.infer<typeof sessionInput>,
) {
	const session = await readIntegrationSession(root);
	if (
		!session ||
		session.id !== input.sessionId ||
		session.projectId !== projectId ||
		session.workspaceId !== input.workspaceId
	)
		throw new TRPCError({ code: "NOT_FOUND", message: "SESSION_MISSING" });
	return session;
}
function invalidate(ctx: HostServiceContext, projectId: string) {
	for (const workspace of ctx.db
		.select()
		.from(workspaces)
		.where(eq(workspaces.projectId, projectId))
		.all()) {
		gitStatusStore.recordChange(workspace.id, undefined);
	}
}
export const branchIntegrationRouter = router({
	settings: protectedProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const project = projectFor(ctx, input.projectId);
			const git = createUserSimpleGit(project.repoPath);
			const [refs, remotes, suggestedBranch] = await Promise.all([
				git.raw([
					"for-each-ref",
					"--format=%(refname)",
					"refs/heads",
					"refs/remotes",
				]),
				git.getRemotes(),
				getDefaultBranchName(git),
			]);
			const branches = new Set<string>();
			for (const ref of refs.trim().split("\n")) {
				if (ref.startsWith("refs/heads/")) branches.add(ref.slice(11));
				for (const remote of remotes) {
					const prefix = `refs/remotes/${remote.name}/`;
					if (ref.startsWith(prefix) && ref !== `${prefix}HEAD`)
						branches.add(ref.slice(prefix.length));
				}
			}
			return {
				...configuration(project),
				branches: [...branches].sort(),
				remotes: remotes.map((item) => item.name),
				suggestedBranch,
				suggestedRemote: remotes.some(
					(item) => item.name === project.remoteName,
				)
					? project.remoteName
					: remotes.some((item) => item.name === "origin")
						? "origin"
						: null,
			};
		}),
	setSettings: protectedProcedure
		.input(settingsInput)
		.mutation(async ({ ctx, input }) => {
			const project = projectFor(ctx, input.projectId);
			return guarded(project.repoPath, async () => {
				const git = createUserSimpleGit(project.repoPath);
				if (input.mergeTargetBranch)
					await git.raw([
						"check-ref-format",
						`refs/heads/${input.mergeTargetBranch}`,
					]);
				if (
					input.updateRemote &&
					!(await git.getRemotes()).some(
						(item) => item.name === input.updateRemote,
					)
				)
					throw new IntegrationError("REMOTE_MISSING");
				const { projectId, ...settings } = input;
				ctx.db
					.update(projects)
					.set({ ...settings, updatedAt: Date.now() })
					.where(eq(projects.id, projectId))
					.run();
				emitProjectChanged(ctx.eventBus, "updated", projectFor(ctx, projectId));
				return settings;
			});
		}),
	status: protectedProcedure
		.input(workspaceInput)
		.query(async ({ ctx, input }) => {
			const project = workspaceProject(ctx, input.workspaceId);
			return guarded(
				project.repoPath,
				async (root) => {
					const session = await readIntegrationSession(root);
					const ownSession =
						session?.workspaceId === input.workspaceId &&
						session.projectId === project.id
							? session
							: null;
					return {
						...configuration(project),
						projectId: project.id,
						session: ownSession,
						pendingPaths: ownSession
							? await pendingConflictPaths(root, ownSession)
							: [],
						busyElsewhere:
							!!session &&
							!ownSession &&
							(!["completed", "cancelled"].includes(session.state) ||
								session.cleanupPending),
					};
				},
				true,
			);
		}),
	start: protectedProcedure
		.input(workspaceInput.extend({ kind: integrationKind }))
		.mutation(async ({ ctx, input }) => {
			const project = workspaceProject(ctx, input.workspaceId);
			return guarded(project.repoPath, async (root) => {
				const workspacePath = resolveWorktreePath(ctx, input.workspaceId);
				const session = await startIntegration({
					root,
					repoPath: project.repoPath,
					projectId: project.id,
					workspaceId: input.workspaceId,
					workspacePath,
					kind: input.kind,
					settings: project,
					fetchEnv:
						input.kind === "update"
							? await createGitEnvResolver(ctx.credentials)(workspacePath)
							: undefined,
				});
				try {
					return session.state === "ready"
						? await finishIntegration(
								project.repoPath,
								root,
								session,
								projectFor(ctx, project.id),
							)
						: session;
				} finally {
					invalidate(ctx, project.id);
				}
			});
		}),
	conflict: protectedProcedure
		.input(sessionInput.extend({ path: z.string() }))
		.query(async ({ ctx, input }) => {
			const project = workspaceProject(ctx, input.workspaceId);
			return guarded(project.repoPath, async (root) =>
				readConflict(
					root,
					await requireSession(root, project.id, input),
					input.path,
				),
			);
		}),
	resolve: protectedProcedure
		.input(
			sessionInput.extend({
				path: z.string(),
				choice: z.enum(["source", "destination", "delete", "manual"]),
				content: z
					.string()
					.max(1024 * 1024)
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const project = workspaceProject(ctx, input.workspaceId);
			return guarded(project.repoPath, async (root) =>
				resolveConflict(
					root,
					await requireSession(root, project.id, input),
					input.path,
					input.choice,
					input.content,
				),
			);
		}),
	finish: protectedProcedure
		.input(sessionInput)
		.mutation(async ({ ctx, input }) => {
			const project = workspaceProject(ctx, input.workspaceId);
			return guarded(project.repoPath, async (root) => {
				try {
					return await finishIntegration(
						project.repoPath,
						root,
						await requireSession(root, project.id, input),
						project,
					);
				} finally {
					invalidate(ctx, project.id);
				}
			});
		}),
	cancel: protectedProcedure
		.input(sessionInput)
		.mutation(async ({ ctx, input }) => {
			const project = workspaceProject(ctx, input.workspaceId);
			return guarded(project.repoPath, async (root) =>
				cancelIntegration(
					project.repoPath,
					root,
					await requireSession(root, project.id, input),
				),
			);
		}),
});
