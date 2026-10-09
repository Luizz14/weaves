import { Database } from "bun:sqlite";
import { join } from "node:path";
import { SUPERSET_HOME } from "./app";

function openHostDb(organizationId: string): Database {
	return new Database(join(SUPERSET_HOME, "host", organizationId, "host.db"), {
		readonly: true,
	});
}

export function projectRepoPath(
	organizationId: string,
	projectId: string,
): string | null {
	const db = openHostDb(organizationId);
	try {
		const row = db
			.query<{ repo_path: string }, [string]>(
				"select repo_path from projects where id = ?",
			)
			.get(projectId);
		return row?.repo_path ?? null;
	} finally {
		db.close();
	}
}

export interface WorkspaceRow {
	projectId: string | null;
	worktreePath: string;
	branch: string;
}

export function workspaceRow(
	organizationId: string,
	workspaceId: string,
): WorkspaceRow | null {
	const db = openHostDb(organizationId);
	try {
		const row = db
			.query<
				{ project_id: string | null; worktree_path: string; branch: string },
				[string]
			>("select project_id, worktree_path, branch from workspaces where id = ?")
			.get(workspaceId);
		return row
			? {
					projectId: row.project_id,
					worktreePath: row.worktree_path,
					branch: row.branch,
				}
			: null;
	} finally {
		db.close();
	}
}

export function projectsOf(
	organizationId: string,
): Array<{ id: string; name: string; repoPath: string }> {
	const db = openHostDb(organizationId);
	try {
		return db
			.query<{ id: string; name: string; repo_path: string }, []>(
				"select id, name, repo_path from projects",
			)
			.all()
			.map((row) => ({ id: row.id, name: row.name, repoPath: row.repo_path }));
	} finally {
		db.close();
	}
}
