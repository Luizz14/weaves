import {
	type Item,
	isKnownItem,
	type SessionState,
	type Turn,
} from "@superset/chat/protocol";
import { TRPCError } from "@trpc/server";
import type { ChatRuntime } from "../../index";
import { readSince } from "../../replay";

export function createEnsureCodexSession(
	runtime: ChatRuntime,
	resolveCwd: (workspaceId: string) => string | Promise<string>,
) {
	const loading = new Map<string, Promise<void>>();
	async function resume(sessionId: string) {
		const row = runtime.sessions.get(sessionId);
		if (!row || row.harness !== "codex") return;
		const live = runtime.live.get(sessionId);
		if (live && live.state.status !== "dead") return;
		const cwd = await resolveCwd(row.scopeId);
		const replay = readSince(runtime.db, sessionId, {
			epoch: row.epoch,
			seq: 0,
		});
		if (!replay.ok)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Chat history is unavailable",
			});
		let state: SessionState | null = null;
		const turns = new Map<string, Turn>();
		const items = new Map<string, { item: Item; turnId: string }>();
		for (const envelope of replay.envelopes) {
			const event = envelope.event;
			if (event.type === "session") state = event.session;
			if (event.type === "turn") turns.set(event.turn.id, event.turn);
			if (event.type === "item") {
				items.set(event.item.id, { item: event.item, turnId: event.turnId });
			}
		}
		const hasPrompts = [...items.values()].some(
			({ item }) => item.kind === "user_message",
		);
		if (!row.harnessSessionId && hasPrompts)
			throw new TRPCError({
				code: "CONFLICT",
				message:
					"This legacy session cannot be resumed. Start a new chat; its history is preserved.",
			});
		await runtime.live.dispose(sessionId);
		const publish = (
			event: Parameters<typeof runtime.journal.appendEnvelope>[1],
		) =>
			runtime.subscriptions.publish(
				runtime.journal.appendEnvelope(sessionId, event),
			);
		for (const turn of turns.values())
			if (turn.status === "running")
				publish({
					type: "turn",
					turn: { ...turn, status: "interrupted", completedAtMs: Date.now() },
				});
		for (const { item, turnId } of items.values()) {
			if (
				isKnownItem(item) &&
				item.kind === "approval_request" &&
				item.status === "pending"
			)
				publish({ type: "item", turnId, item: { ...item, status: "stale" } });
			if (
				isKnownItem(item) &&
				item.kind === "tool_call" &&
				item.status === "running"
			)
				publish({
					type: "item",
					turnId,
					item: { ...item, status: "canceled", completedAtMs: Date.now() },
				});
		}
		runtime.live.create({
			sessionId,
			scopeId: row.scopeId,
			harness: row.harness,
			cwd,
			modeId: state?.modeId ?? "auto",
			modelId: state?.modelId,
			...(row.harnessSessionId
				? { resume: { harnessSessionId: row.harnessSessionId } }
				: {}),
		});
	}
	return (sessionId: string): Promise<void> => {
		const current = loading.get(sessionId);
		if (current) return current;
		const next = resume(sessionId).finally(() => loading.delete(sessionId));
		loading.set(sessionId, next);
		return next;
	};
}
