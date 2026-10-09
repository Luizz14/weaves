import type { Session } from "../lib/session";

export interface BenchContext {
	session: Session;
	runId: string;
	perfBench: { id: string; worktreePath: string };
	switchTargets: string[];
	chatWorkspace: string | null;
	count: (n: number) => number;
	warmups: (n: number) => number;
	reload: () => Promise<void>;
	log: (message: string) => void;
}

export function phaseFor(index: number, warmups: number) {
	return index < warmups ? ("warmup" as const) : ("measured" as const);
}

export function workspaceScope(workspaceId: string): string {
	return `[data-workspace-id="${workspaceId}"]`;
}

export async function tabCount(
	session: Session,
	workspaceId: string,
): Promise<number> {
	return session.eval<number>(
		`document.querySelectorAll('${workspaceScope(workspaceId)} [data-tab-id]').length`,
	);
}

export async function closeAddedTabs(
	session: Session,
	workspaceId: string,
	baseline: number,
): Promise<void> {
	for (let i = 0; i < 4; i++) {
		if ((await tabCount(session, workspaceId)) <= baseline) return;
		await session.closeActivePane();
	}
	if ((await tabCount(session, workspaceId)) > baseline) {
		throw new Error("could not close the tab opened by the journey");
	}
}
