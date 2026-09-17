import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHarness } from "../../harness/fake";
import { createChatRuntime, type HarnessFactoryOptions } from "../../index";
import { createBunChatDb } from "../../testing/testRuntime/testRuntime";
import { waitFor } from "../../testing/testUtils";
import { createChatCallerFactory, createChatRouter } from "./router";

function stack(dataDir: string, starts: HarnessFactoryOptions[]) {
	const runtime = createChatRuntime({
		dataDir,
		openDatabase: createBunChatDb,
		harnesses: new Map([
			[
				"codex",
				(options: HarnessFactoryOptions) => {
					starts.push(options);
					const id = `turn-${starts.length}`;
					return new FakeHarness({
						start: [
							{
								kind: "session",
								session: {
									status: "idle",
									harnessSessionId: "codex-thread",
									modeId: options.modeId ?? "auto",
								},
							},
						],
						turns: [
							[
								{
									kind: "turn",
									turn: { id, status: "running", startedAtMs: Date.now() },
								},
								{
									kind: "item",
									turnId: id,
									item: {
										id: `answer-${id}`,
										kind: "agent_message",
										text: "done",
										startedAtMs: Date.now(),
									},
								},
								{
									kind: "turn",
									turn: { id, status: "completed", startedAtMs: Date.now() },
								},
								{ kind: "session", session: { status: "idle" } },
							],
						],
					});
				},
			],
			["claude-code", () => new FakeHarness({ turns: [] })],
		]),
	});
	const resolved: string[] = [];
	const caller = createChatCallerFactory(
		createChatRouter(runtime, {
			resolveCwd: (workspaceId) => {
				resolved.push(workspaceId);
				return dataDir;
			},
			resolveWorkspace: (workspaceId) => ({
				path: dataDir,
				name: workspaceId,
			}),
			resolveAttachment: () => null,
		}),
	)({});
	return { runtime, caller, resolved };
}

describe("Codex chat sessions", () => {
	test("filters harness and workspace before applying the limit", async () => {
		const dir = mkdtempSync(join(tmpdir(), "codex-filter-"));
		const { runtime, caller } = stack(dir, []);
		try {
			const codex = await caller.createSession({
				commandId: randomUUID(),
				workspaceId: "one",
				harness: "codex",
			});
			await caller.createSession({
				commandId: randomUUID(),
				workspaceId: "one",
				harness: "claude-code",
			});
			await caller.createSession({
				commandId: randomUUID(),
				workspaceId: "two",
				harness: "codex",
			});
			expect(
				(
					await caller.listSessions({
						workspaceId: "one",
						harness: "codex",
						limit: 1,
					})
				).map((s) => s.sessionId),
			).toEqual([codex.sessionId]);
			expect(await caller.listSessions({ workspaceId: "one" })).toHaveLength(2);
			expect(await caller.listSessions({ harness: "missing" })).toEqual([]);
		} finally {
			await runtime.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	test("persists the Codex thread and resumes once after reopening the database", async () => {
		const dir = mkdtempSync(join(tmpdir(), "codex-resume-"));
		const starts: HarnessFactoryOptions[] = [];
		const first = stack(dir, starts);
		const created = await first.caller.createSession({
			commandId: randomUUID(),
			workspaceId: "workspace",
			harness: "codex",
			modeId: "read-only",
		});
		await waitFor(
			() =>
				first.runtime.sessions.get(created.sessionId)?.harnessSessionId ===
				"codex-thread",
		);
		await first.caller.prompt({
			commandId: randomUUID(),
			sessionId: created.sessionId,
			clientId: "first",
			content: [{ type: "text", text: "hello" }],
		});
		await waitFor(
			() =>
				first.runtime.live.get(created.sessionId)?.turn?.status === "completed",
		);
		const before = await first.caller.getItems({
			sessionId: created.sessionId,
		});
		await first.runtime.dispose();
		const second = stack(dir, starts);
		try {
			expect(
				(await second.caller.getSession({ sessionId: created.sessionId }))
					.isLive,
			).toBe(false);
			const input = {
				commandId: randomUUID(),
				sessionId: created.sessionId,
				clientId: "second",
				content: [{ type: "text" as const, text: "continue" }],
			};
			await Promise.all([
				second.caller.prompt(input),
				second.caller.prompt(input),
			]);
			await waitFor(
				() =>
					second.runtime.live.get(created.sessionId)?.turn?.status ===
					"completed",
			);
			expect(starts).toHaveLength(2);
			expect(starts[1]?.resume).toEqual({ harnessSessionId: "codex-thread" });
			expect(starts[1]?.modeId).toBe("read-only");
			expect(second.runtime.live.get(created.sessionId)?.state.title).toBe(
				"hello",
			);
			expect(second.resolved).toEqual(["workspace"]);
			const after = await second.caller.getItems({
				sessionId: created.sessionId,
			});
			if (!before.ok || !after.ok) throw new Error("missing history");
			expect(after.envelopes.length).toBeGreaterThan(before.envelopes.length);
			expect(
				new Set(
					after.envelopes.flatMap((e) =>
						e.event.type === "item" &&
						e.event.item.kind === "user_message" &&
						e.event.item.clientId === "second"
							? [e.event.item.id]
							: [],
					),
				).size,
			).toBe(1);
		} finally {
			await second.runtime.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	test("a resumed session keeps its linked workspaces", async () => {
		const dir = mkdtempSync(join(tmpdir(), "codex-linked-"));
		const starts: HarnessFactoryOptions[] = [];
		const first = stack(dir, starts);
		const created = await first.caller.createSession({
			commandId: randomUUID(),
			workspaceId: "workspace",
			harness: "codex",
		});
		await waitFor(
			() =>
				first.runtime.sessions.get(created.sessionId)?.harnessSessionId ===
				"codex-thread",
		);
		const linked = await first.caller.setLinkedWorkspaces({
			commandId: randomUUID(),
			sessionId: created.sessionId,
			workspaceIds: ["docs"],
		});
		expect(linked).toEqual([{ workspaceId: "docs", path: dir, name: "docs" }]);
		await first.runtime.dispose();

		const second = stack(dir, starts);
		try {
			await second.caller.prompt({
				commandId: randomUUID(),
				sessionId: created.sessionId,
				clientId: "second",
				content: [{ type: "text", text: "continue" }],
			});
			expect(starts[1]?.linkedWorkspaces).toEqual(linked);
			expect(
				second.runtime.live.get(created.sessionId)?.state.linkedWorkspaces,
			).toEqual(linked);
		} finally {
			await second.runtime.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	test("keeps legacy history intact when no resumable thread was recorded", async () => {
		const dir = mkdtempSync(join(tmpdir(), "codex-legacy-"));
		const { runtime, caller } = stack(dir, []);
		try {
			runtime.journal.open({
				sessionId: "legacy",
				scopeId: "workspace",
				harness: "codex",
			});
			runtime.journal.append("legacy", {
				type: "item",
				turnId: "old",
				item: {
					id: "user",
					kind: "user_message",
					startedAtMs: 1,
					content: [{ type: "text", text: "saved" }],
				},
			});
			await expect(
				caller.prompt({
					commandId: randomUUID(),
					sessionId: "legacy",
					clientId: "new",
					content: [{ type: "text", text: "continue" }],
				}),
			).rejects.toThrow("cannot be resumed");
			expect(
				(await caller.getSession({ sessionId: "legacy" })).session,
			).not.toBeNull();
		} finally {
			await runtime.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

test("restores Codex options even when the latest message page has no session event", async () => {
	const dir = mkdtempSync(join(tmpdir(), "codex-config-page-"));
	const { runtime, caller } = stack(dir, []);
	try {
		runtime.journal.open({
			sessionId: "saved",
			scopeId: "workspace",
			harness: "codex",
		});
		const execution = {
			modelId: "gpt-5.6-luna",
			reasoningEffort: "max",
			collaborationMode: "plan" as const,
			fast: true,
		};
		runtime.journal.append("saved", {
			type: "session",
			session: { harness: "codex", status: "idle", execution },
		});
		runtime.journal.append("saved", {
			type: "item",
			turnId: "turn",
			item: {
				id: "answer",
				kind: "agent_message",
				text: "done",
				startedAtMs: 1,
			},
		});
		const page = await caller.getItems({ sessionId: "saved", limit: 1 });
		expect(
			page.ok && page.envelopes.every((e) => e.event.type !== "session"),
		).toBe(true);
		expect(
			(await caller.getSession({ sessionId: "saved" })).state?.execution,
		).toEqual(execution);
	} finally {
		await runtime.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});
