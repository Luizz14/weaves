import { eq } from "drizzle-orm";
import { projects } from "../../../../db/schema";
import { createGitEnvResolver } from "../../../../runtime/git";
import type { HostServiceContext } from "../../../../types";
import { getHostWorkerPool } from "../../../../workers/host-worker-pool";
import { gitBranchPublishedTask } from "../../../../workers/tasks/git";
import {
	getLocalWorkspace,
	updateLocalWorkspace,
} from "../../../../workspaces/local-workspace-store";
import {
	applyGeneratedWorkspaceNames,
	generateWorkspaceBranchFromPrompt,
} from "./ai-workspace-names";
import { isAutoNameEligible } from "./auto-name-eligibility";
import { resolveRenameBranchPrefix } from "./branch-prefix";
import {
	buildNamingContext,
	readRecentWorkspaceSessions,
} from "./workspace-activity";

const inFlight = new Set<string>();

async function isBranchPublished(
	ctx: HostServiceContext,
	worktreePath: string,
	branch: string,
): Promise<boolean> {
	try {
		const gitEnv = await createGitEnvResolver(ctx.credentials)(worktreePath);
		const { published } = await getHostWorkerPool().run(
			gitBranchPublishedTask,
			{ worktreePath, branch, gitEnv },
			{ timeoutMs: 15_000 },
		);
		return published;
	} catch (err) {
		console.warn("[autoNameFromActivity] publish check failed", err);
		return true;
	}
}

/**
 * Azure work items keep the `feature/<id>-...` shape the work-item dialog
 * creates, so every repository's branch still names the story.
 */
export function resolveActivityBranchCandidate({
	branchName,
	externalWorkItemProvider,
	externalWorkItemId,
}: {
	branchName: string;
	externalWorkItemProvider: string | null;
	externalWorkItemId: string | null;
}): { candidate: string; fixedPrefix: string | null } {
	if (externalWorkItemProvider === "azure-devops" && externalWorkItemId) {
		return {
			candidate: `${externalWorkItemId}-${branchName}`,
			fixedPrefix: "feature",
		};
	}
	return { candidate: branchName, fixedPrefix: null };
}

/**
 * Names a workspace after what its agent was asked to do. Unforced calls
 * (the agent's Stop hook) only touch names nobody chose; the branch follows
 * only while it has never left this machine, and the worktree directory
 * never moves.
 */
export async function autoNameWorkspaceFromActivity(
	ctx: HostServiceContext,
	workspaceId: string,
	options: { force?: boolean } = {},
): Promise<{ name: string; branch: string } | null> {
	if (inFlight.has(workspaceId)) return null;
	inFlight.add(workspaceId);
	try {
		const row = getLocalWorkspace(ctx.db, workspaceId);
		if (!row || row.archivedAt || !row.projectId) return null;
		if (!options.force && !isAutoNameEligible(row)) return null;
		const projectId = row.projectId;
		const project = ctx.db.query.projects
			.findFirst({ where: eq(projects.id, projectId) })
			.sync();
		if (!project?.repoPath) return null;

		const [session] = readRecentWorkspaceSessions(ctx.db, workspaceId, {
			limit: 1,
		});
		const context = session ? buildNamingContext(session) : "";
		if (!context) return null;

		const names = await generateWorkspaceBranchFromPrompt(
			context,
			ctx.db,
			project.namingInstructions,
		);
		if (!names) return null;

		const current = getLocalWorkspace(ctx.db, workspaceId);
		if (!current) return null;
		if (!options.force && !isAutoNameEligible(current)) return null;

		const renameBranch =
			current.type === "worktree" &&
			!(await isBranchPublished(ctx, current.worktreePath, current.branch));
		const { candidate, fixedPrefix } = resolveActivityBranchCandidate({
			branchName: names.branchName,
			externalWorkItemProvider: current.externalWorkItemProvider,
			externalWorkItemId: current.externalWorkItemId,
		});
		const branchPrefix = !renameBranch
			? undefined
			: (fixedPrefix ?? (await resolveRenameBranchPrefix(ctx, project)));

		const applied = await applyGeneratedWorkspaceNames({
			ctx,
			workspaceId,
			repoPath: project.repoPath,
			worktreePath: current.worktreePath,
			oldBranchName: current.branch,
			oldWorkspaceName: current.name || current.branch,
			names: { title: names.title, branchName: candidate },
			renameTitle: true,
			renameBranch,
			branchPrefix,
		});
		if (!applied && !options.force && current.nameSource !== "ai") {
			updateLocalWorkspace(ctx, workspaceId, { nameSource: "ai" });
		}
		return applied;
	} finally {
		inFlight.delete(workspaceId);
	}
}
