import { describe, expect, test } from "bun:test";
import type { Notice } from "@superset/chat/protocol";
import type { AdapterEvent } from "../../types";
import { FixturePlayer } from "../fixturePlayer";
import { fixtureCwd, loadCodexFixture } from "../fixtures";
import type { CodexTransportHandlers } from "../rpcClient";
import { CodexAdapter } from "./codexAdapter";

const THREAD_ID = "thread-1";
const TURN_ID = "turn-1";

type Harness = {
	adapter: CodexAdapter;
	events: AdapterEvent[];
	sent: Record<string, unknown>[];
	receive(frame: unknown): void;
	settle(): Promise<void>;
};

function startAdapter({
	respondTurnStart = false,
	reportedModel = "gpt-5.5",
	reportedEffort,
}: {
	respondTurnStart?: boolean;
	reportedModel?: string;
	reportedEffort?: string;
} = {}): Harness {
	const sent: Record<string, unknown>[] = [];
	const events: AdapterEvent[] = [];
	let handlers: CodexTransportHandlers | null = null;
	let nativeGoal: Record<string, unknown> | null = null;

	const adapter = new CodexAdapter({
		now: () => 1_785_000_000_000,
		mintId: () => "minted",
		createTransport: (_options, transportHandlers) => {
			handlers = transportHandlers;
			return {
				send: (line) => {
					const frame = JSON.parse(line) as {
						id?: number;
						method?: string;
						params?: Record<string, unknown>;
					};
					sent.push(frame);
					if (frame.method === "initialize") {
						handlers?.onLine(
							JSON.stringify({
								id: frame.id,
								result: {
									userAgent: "superset-chat-runtime/0.143.0 (Mac OS)",
								},
							}),
						);
						return;
					}
					if (frame.method === "thread/goal/set") {
						nativeGoal = {
							objective: "goal",
							status: "paused",
							tokenBudget: null,
							tokensUsed: 0,
							timeUsedSeconds: 0,
							...nativeGoal,
							...frame.params,
						};
						handlers?.onLine(
							JSON.stringify({ id: frame.id, result: { goal: nativeGoal } }),
						);
					}
					if (frame.method === "thread/goal/clear") {
						nativeGoal = null;
						handlers?.onLine(JSON.stringify({ id: frame.id, result: {} }));
					}
					if (frame.method === "turn/start" && respondTurnStart)
						handlers?.onLine(
							JSON.stringify({
								id: frame.id,
								result: {
									turn: {
										id: TURN_ID,
										status: "inProgress",
										items: [],
										error: null,
									},
								},
							}),
						);
					if (frame.method === "model/list") {
						handlers?.onLine(
							JSON.stringify({
								id: frame.id,
								result: {
									data: [
										{
											id: "gpt-5.6-luna",
											model: "gpt-5.6-luna",
											displayName: "Luna",
											supportedReasoningEfforts: [
												{ reasoningEffort: "medium", description: "" },
												{ reasoningEffort: "max", description: "" },
											],
											defaultReasoningEffort: "medium",
											serviceTiers: [
												{ id: "priority", name: "Fast", description: "" },
											],
										},
									],
									nextCursor: null,
								},
							}),
						);
					}
					if (frame.method === "thread/unsubscribe")
						handlers?.onLine(JSON.stringify({ id: frame.id, result: {} }));
					if (
						frame.method === "thread/start" ||
						frame.method === "thread/resume"
					) {
						handlers?.onLine(
							JSON.stringify({
								id: frame.id,
								result: {
									thread: { id: THREAD_ID },
									model: reportedModel,
									reasoningEffort: reportedEffort,
								},
							}),
						);
					}
				},
				close: async () => undefined,
			};
		},
	});

	void (async () => {
		for await (const event of adapter.start({ cwd: "/tmp/workspace" })) {
			events.push(event);
		}
	})();

	return {
		adapter,
		events,
		sent,
		receive: (frame) => handlers?.onLine(JSON.stringify(frame)),
		settle: async () => {
			for (let index = 0; index < 6; index += 1) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		},
	};
}

function notices(events: AdapterEvent[]): Notice[] {
	return events.flatMap((event) =>
		event.kind === "item" && event.item.kind === "notice"
			? [event.item as Notice]
			: [],
	);
}

describe("codex adapter resilience", () => {
	test("ignores deprecation notices", async () => {
		const harness = startAdapter();
		await harness.settle();
		const initialNoticeCount = notices(harness.events).length;

		harness.receive({
			method: "deprecationNotice",
			params: { message: "deprecated", threadId: THREAD_ID },
		});
		await harness.settle();

		expect(notices(harness.events)).toHaveLength(initialNoticeCount);
		await harness.adapter.dispose();
	});

	test("an unreadable notification becomes a notice, not a thrown frame", async () => {
		const harness = startAdapter();
		await harness.settle();

		expect(() =>
			harness.receive({
				method: "item/started",
				params: { item: { type: "agentMessage" }, threadId: THREAD_ID },
			}),
		).not.toThrow();
		await harness.settle();

		expect(notices(harness.events).at(-1)).toMatchObject({
			noticeKind: "error",
		});
		expect(
			notices(harness.events).at(-1)?.text?.startsWith("codex item/started"),
		).toBe(true);

		await harness.adapter.dispose();
	});

	test("an unreadable server request is answered so codex is not left waiting", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.receive({
			id: "srv-1",
			method: "item/commandExecution/requestApproval",
			params: { threadId: THREAD_ID },
		});
		await harness.settle();

		const response = harness.sent.find((frame) => frame.id === "srv-1");
		expect(response).toMatchObject({ error: { code: -32601 } });
		expect(notices(harness.events).at(-1)?.noticeKind).toBe("error");

		await harness.adapter.dispose();
	});

	test("a stream that keeps arriving after a bad frame still maps items", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.receive({ method: "item/started", params: { nonsense: true } });
		harness.receive({
			method: "item/completed",
			params: {
				item: { type: "agentMessage", id: "msg-1", text: "hello" },
				threadId: THREAD_ID,
				turnId: TURN_ID,
				completedAtMs: 5,
			},
		});
		await harness.settle();

		const messages = harness.events.flatMap((event) =>
			event.kind === "item" && event.item.kind === "agent_message"
				? [event.item]
				: [],
		);
		expect(messages.at(-1)).toMatchObject({ id: "msg-1", text: "hello" });

		await harness.adapter.dispose();
	});
});

describe("codex cancel before the turn is running", () => {
	test("a cancel raced against turn/start is applied when the turn appears", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.adapter.prompt([{ type: "text", text: "go" }]);
		await harness.settle();
		expect(harness.sent.some((frame) => frame.method === "turn/start")).toBe(
			true,
		);

		harness.adapter.cancelTurn();
		expect(
			harness.sent.some((frame) => frame.method === "turn/interrupt"),
		).toBe(false);

		harness.receive({
			method: "turn/started",
			params: {
				threadId: THREAD_ID,
				turn: { id: TURN_ID, status: "inProgress", startedAt: 1 },
			},
		});

		const interrupt = harness.sent.find(
			(frame) => frame.method === "turn/interrupt",
		);
		expect(interrupt).toMatchObject({
			params: { threadId: THREAD_ID, turnId: TURN_ID },
		});

		await harness.adapter.dispose();
	});

	test("a cancel with no turn in flight is not held against the next turn", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.adapter.cancelTurn();
		harness.adapter.prompt([{ type: "text", text: "go" }]);
		await harness.settle();

		harness.receive({
			method: "turn/started",
			params: {
				threadId: THREAD_ID,
				turn: { id: TURN_ID, status: "inProgress", startedAt: 1 },
			},
		});

		expect(
			harness.sent.some((frame) => frame.method === "turn/interrupt"),
		).toBe(false);

		await harness.adapter.dispose();
	});

	test("a cancel after the turn already settled is dropped", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.adapter.prompt([{ type: "text", text: "go" }]);
		await harness.settle();
		harness.receive({
			method: "turn/completed",
			params: {
				threadId: THREAD_ID,
				turn: {
					id: TURN_ID,
					status: "completed",
					startedAt: 1,
					completedAt: 2,
				},
			},
		});

		harness.adapter.cancelTurn();
		expect(
			harness.sent.some((frame) => frame.method === "turn/interrupt"),
		).toBe(false);

		await harness.adapter.dispose();
	});
});

describe("codex fixtures still map after the guards", () => {
	test("the command fixture is unchanged by the dispatch wrapper", async () => {
		const frames = loadCodexFixture("command");
		const player = new FixturePlayer(frames);
		const adapter = new CodexAdapter({
			createTransport: (_options, handlers) => player.transport(handlers),
		});
		const events: AdapterEvent[] = [];
		const pump = (async () => {
			for await (const event of adapter.start({ cwd: fixtureCwd(frames) })) {
				events.push(event);
			}
		})();
		adapter.prompt([{ type: "text", text: "fixture prompt" }]);

		const deadline = Date.now() + 5000;
		while (!player.exhausted) {
			if (Date.now() > deadline) throw new Error("fixture stalled");
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
		await adapter.dispose();
		await pump;

		expect(notices(events)).toEqual([]);
		const calls = events.flatMap((event) =>
			event.kind === "item" && event.item.kind === "tool_call"
				? [event.item]
				: [],
		);
		expect(calls.at(-1)).toMatchObject({ status: "completed" });
	});
});

test("session notices can be persisted before the first turn", async () => {
	const harness = startAdapter();
	await harness.settle();
	harness.receive({ method: "future/sessionNotification", params: {} });
	await harness.settle();
	const notice = harness.events.find(
		(event) => event.kind === "item" && event.item.kind === "notice",
	);
	expect(notice?.kind === "item" ? notice.turnId : null).toBe("codex:session");
	await harness.adapter.dispose();
});

test("mode changes use the app-server sandboxPolicy on subsequent turns", async () => {
	const harness = startAdapter();
	await harness.settle();
	harness.adapter.setMode("full-access");
	harness.adapter.prompt([{ type: "text", text: "first" }]);
	await harness.settle();
	harness.adapter.setMode("read-only");
	harness.adapter.prompt([{ type: "text", text: "second" }]);
	await harness.settle();
	const requests = harness.sent.filter(
		(frame) => frame.method === "turn/start",
	);
	expect(requests[0]?.params).toMatchObject({
		approvalPolicy: "never",
		sandboxPolicy: { type: "dangerFullAccess" },
	});
	expect(requests[1]?.params).toMatchObject({
		approvalPolicy: "on-request",
		sandboxPolicy: { type: "readOnly", networkAccess: false },
	});
	expect(requests[1]?.params).not.toHaveProperty("sandbox");
	await harness.adapter.dispose();
});

test("configured model, effort, Fast, and native planning are sent together", async () => {
	const h = startAdapter();
	await h.settle();
	const execution = {
		modelId: "gpt-5.6-luna",
		reasoningEffort: "max",
		fast: true,
		collaborationMode: "plan" as const,
	};
	await h.adapter.configureCodex(execution);
	h.adapter.prompt([{ type: "text", text: "plan" }], execution);
	await h.settle();
	const frame = [...h.sent]
		.reverse()
		.find((entry) => entry.method === "turn/start");
	expect(frame?.params).toMatchObject({
		model: "gpt-5.6-luna",
		effort: "max",
		serviceTier: "priority",
		collaborationMode: {
			mode: "plan",
			settings: {
				model: "gpt-5.6-luna",
				reasoning_effort: "max",
				developer_instructions: null,
			},
		},
	});
	await h.adapter.dispose();
});
test("answers structured questions through the original server request and expires them", async () => {
	const h = startAdapter();
	await h.settle();
	const params = {
		threadId: THREAD_ID,
		turnId: TURN_ID,
		itemId: "q",
		isBlocking: true,
		questions: [
			{
				id: "decision",
				header: "Scope",
				question: "Which scope?",
				isOther: false,
				isSecret: false,
				options: [{ label: "Local", description: "Current workspace" }],
			},
		],
	};
	h.receive({ id: 99, method: "item/tool/requestUserInput", params });
	await h.settle();
	expect(() =>
		h.adapter.respondToUserInput("question:turn-1:q:99", {
			decision: ["unexpected"],
		}),
	).toThrow();
	h.adapter.respondToUserInput("question:turn-1:q:99", { decision: ["Local"] });
	await h.settle();
	expect(h.sent.find((entry) => entry.id === 99)).toMatchObject({
		result: { answers: { decision: { answers: ["Local"] } } },
	});
	const answered = [...h.events]
		.reverse()
		.find(
			(event) =>
				event.kind === "item" && event.item.id === "question:turn-1:q:99",
		);
	expect(answered?.kind === "item" ? answered.item : null).toMatchObject({
		status: "answered",
	});
	h.receive({ id: 100, method: "item/tool/requestUserInput", params });
	await h.settle();
	h.receive({
		method: "serverRequest/resolved",
		params: { threadId: THREAD_ID, requestId: 100 },
	});
	await h.settle();
	expect(() =>
		h.adapter.respondToUserInput("question:turn-1:q:100", {
			decision: ["Local"],
		}),
	).toThrow("expired");
	await h.adapter.dispose();
});

test("goal activation leaves native planning with exactly one kickoff turn", async () => {
	const h = startAdapter({ respondTurnStart: true });
	await h.settle();
	await h.adapter.configureCodex({
		modelId: "gpt-5.6-luna",
		reasoningEffort: "medium",
		fast: false,
		collaborationMode: "plan",
	});
	await h.adapter.updateGoal({
		action: "set",
		objective: "Implement the plan",
	});
	const requests = h.sent.filter(
		(entry) =>
			entry.method === "thread/goal/set" || entry.method === "turn/start",
	);
	expect(requests.map((entry) => entry.method)).toEqual([
		"thread/goal/set",
		"turn/start",
		"thread/goal/set",
	]);
	expect(requests[0]?.params).toMatchObject({
		status: "paused",
		objective: "Implement the plan",
	});
	expect(requests[1]?.params).toMatchObject({
		collaborationMode: { mode: "default" },
		input: [{ type: "text", text: "Implement the plan" }],
	});
	expect(requests[2]?.params).toMatchObject({ status: "active" });
	await h.adapter.dispose();
});

test("pausing during kickoff never reactivates the goal after turn/start returns", async () => {
	const h = startAdapter();
	await h.settle();
	await h.adapter.configureCodex({
		modelId: "gpt-5.6-luna",
		reasoningEffort: "medium",
		fast: false,
		collaborationMode: "default",
	});
	const activation = h.adapter.updateGoal({ action: "set", objective: "Work" });
	await h.settle();
	const request = [...h.sent]
		.reverse()
		.find((entry) => entry.method === "turn/start");
	if (!request) throw Error("missing kickoff");
	await h.adapter.updateGoal({ action: "pause" });
	h.receive({
		id: request.id,
		result: {
			turn: { id: TURN_ID, status: "inProgress", items: [], error: null },
		},
	});
	await activation;
	const goals = h.sent.filter((entry) => entry.method === "thread/goal/set");
	expect(goals.map((entry) => entry.params)).toEqual([
		{ threadId: THREAD_ID, objective: "Work", status: "paused" },
		{ threadId: THREAD_ID, status: "paused" },
	]);
	await h.adapter.dispose();
});

test("permission changes also reach native autonomous goal turns", async () => {
	const h = startAdapter({ respondTurnStart: true });
	await h.settle();
	await h.adapter.configureCodex({
		modelId: "gpt-5.6-luna",
		reasoningEffort: "medium",
		fast: false,
		collaborationMode: "default",
	});
	await h.adapter.updateGoal({ action: "set", objective: "Work" });
	await h.adapter.setMode("read-only");
	expect(
		[...h.sent].reverse().find((entry) => entry.method === "thread/resume")
			?.params,
	).toMatchObject({ sandbox: "read-only", approvalPolicy: "on-request" });
	await h.adapter.dispose();
});

test("non-blocking questions remain answerable after a completed turn", async () => {
	const h = startAdapter();
	await h.settle();
	h.receive({
		id: 110,
		method: "item/tool/requestUserInput",
		params: {
			threadId: THREAD_ID,
			turnId: TURN_ID,
			itemId: "async",
			isBlocking: false,
			questions: [
				{
					id: "answer",
					header: "Choice",
					question: "Continue?",
					isOther: true,
					isSecret: false,
					options: null,
				},
			],
		},
	});
	await h.settle();
	h.receive({
		method: "turn/completed",
		params: {
			threadId: THREAD_ID,
			turn: { id: TURN_ID, status: "completed", items: [], error: null },
		},
	});
	await h.settle();
	expect(() =>
		h.adapter.respondToUserInput("question:turn-1:async:110", {
			answer: ["Yes"],
		}),
	).not.toThrow();
	expect(h.sent.find((entry) => entry.id === 110)).toMatchObject({
		result: { answers: { answer: { answers: ["Yes"] } } },
	});
	await h.adapter.dispose();
});

test("legacy chats retain their CLI effort when planning is enabled", async () => {
	const h = startAdapter({
		reportedModel: "gpt-5.6-luna",
		reportedEffort: "max",
	});
	await h.settle();
	const configured = await h.adapter.configureCodex({
		modelId: "gpt-5.6-luna",
		reasoningEffort: "default",
		fast: false,
		collaborationMode: "plan",
	});
	expect(configured.reasoningEffort).toBe("max");
	expect(
		[...h.sent].reverse().find((entry) => entry.method === "thread/start")
			?.params,
	).toMatchObject({ config: { model_reasoning_effort: "max" } });
	await h.adapter.dispose();
});
