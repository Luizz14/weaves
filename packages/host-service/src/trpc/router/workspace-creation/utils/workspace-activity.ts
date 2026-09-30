import { desc, eq } from "drizzle-orm";
import type { HostDb } from "../../../../db";
import { terminalAgentBindings } from "../../../../db/schema";
import {
	type HarnessTurn,
	readHarnessTurns,
} from "../../../../terminal/harness-transcript";
import { getLocalWorkspace } from "../../../../workspaces/local-workspace-store";
import { resolveHostAgentConfig } from "../../agents/agents";
import { resolveDefaultAccountEnv } from "../../usage/default-account";

export interface WorkspaceSessionTurns {
	agentId: string;
	lastEventAt: number;
	turns: HarnessTurn[];
}

/**
 * The newest agent sessions bound to a workspace that the person actually
 * typed into, newest first, each read from its harness's own transcript.
 */
export function readRecentWorkspaceSessions(
	db: HostDb,
	workspaceId: string,
	options: { limit: number; maxBytes?: number },
): WorkspaceSessionTurns[] {
	const workspace = getLocalWorkspace(db, workspaceId);
	if (!workspace) return [];
	const bindings = db
		.select()
		.from(terminalAgentBindings)
		.where(eq(terminalAgentBindings.workspaceId, workspaceId))
		.orderBy(desc(terminalAgentBindings.lastEventAt))
		.all();

	const seen = new Set<string>();
	const sessions: WorkspaceSessionTurns[] = [];
	for (const binding of bindings) {
		if (sessions.length >= options.limit) break;
		const sessionId = binding.agentSessionId;
		if (!sessionId || seen.has(sessionId)) continue;
		seen.add(sessionId);
		const config = resolveHostAgentConfig(
			db,
			binding.definitionId ?? binding.agentId,
		);
		const turns = readHarnessTurns({
			agentId: binding.agentId,
			agentSessionId: sessionId,
			worktreePath: workspace.worktreePath,
			env: config ? resolveDefaultAccountEnv(db, config.presetId) : undefined,
			maxBytes: options.maxBytes,
		});
		if (!turns?.some((turn) => turn.role === "user")) continue;
		sessions.push({
			agentId: binding.agentId,
			lastEventAt: binding.lastEventAt,
			turns,
		});
	}
	return sessions;
}

function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * What the naming model sees: how the session opened (first request and the
 * agent's first answer) plus the latest requests, bounded.
 */
export function buildNamingContext(
	session: WorkspaceSessionTurns,
	maxChars = 2_000,
): string {
	const firstUser = session.turns.find((turn) => turn.role === "user");
	if (!firstUser) return "";
	const firstUserIndex = session.turns.indexOf(firstUser);
	const firstReply = session.turns
		.slice(firstUserIndex + 1)
		.find((turn) => turn.role === "assistant");
	const laterRequests = session.turns
		.filter((turn) => turn.role === "user" && turn !== firstUser)
		.slice(-2);
	const parts = [
		`Request: ${clip(firstUser.text, 900)}`,
		...(firstReply ? [`Agent: ${clip(firstReply.text, 500)}`] : []),
		...laterRequests.map((turn) => `Later request: ${clip(turn.text, 250)}`),
	];
	return parts.join("\n").slice(0, maxChars);
}

export interface RecentPrompt {
	text: string;
	at: number | null;
	agentId: string;
}

/** The last `limit` requests across sessions, newest first. */
export function collectRecentPrompts(
	sessions: WorkspaceSessionTurns[],
	limit: number,
	maxChars = 160,
): RecentPrompt[] {
	const prompts: RecentPrompt[] = [];
	for (const session of sessions) {
		const userTurns = session.turns.filter((turn) => turn.role === "user");
		for (let i = userTurns.length - 1; i >= 0; i--) {
			const turn = userTurns[i];
			if (!turn) continue;
			prompts.push({
				text: clip(turn.text, maxChars),
				at: turn.at,
				agentId: session.agentId,
			});
			if (prompts.length >= limit) return prompts;
		}
	}
	return prompts;
}
