import { randomUUID } from "node:crypto";
import type {
	ApprovalRequest,
	Decision,
	Item,
	LinkedWorkspace,
	SessionState,
	ToolCall,
	Turn,
	UserContent,
} from "@superset/chat/protocol";
import {
	type CodexExecution,
	type CodexGoal,
	type CodexGoalAction,
	type CodexModel,
	codexGoalSchema,
	isKnownItem,
	type UserInputAnswers,
	type UserInputRequest,
	userInputRequestSchema,
} from "@superset/chat/protocol";
import { z } from "zod";
import { EventQueue } from "../../eventQueue";
import type {
	AdapterEvent,
	HarnessAdapter,
	HarnessStartOptions,
	ResolvedAttachment,
} from "../../types";
import { readCodexModels, validateCodexExecution } from "../catalog";
import { mapThreadItem } from "../mapThreadItem";
import type {
	CodexNotification,
	CodexServerRequest,
	CodexTransport,
	CodexTransportHandlers,
	SpawnCodexOptions,
} from "../rpcClient";
import {
	CodexRpcClient,
	CodexRpcError,
	spawnCodexTransport,
} from "../rpcClient";
import type { CodexRequestId, CodexThreadItem, CodexTurn } from "../wire";
import {
	commandApprovalParamsSchema,
	errorNotificationSchema,
	fileChangeApprovalParamsSchema,
	itemDeltaSchema,
	itemLifecycleSchema,
	planUpdatedSchema,
	serverRequestResolvedSchema,
	threadStartResponseSchema,
	threadStatusChangedSchema,
	tokenUsageUpdatedSchema,
	turnLifecycleSchema,
	warningNotificationSchema,
} from "../wire";
import type { CodexDecisionOption } from "./approvalDecisions";
import { codexDecision, decisionOptions } from "./approvalDecisions";
import {
	CODEX_MODES,
	codexSandboxPolicy,
	codexTurnPolicy,
	DEFAULT_CODEX_MODE,
} from "./codexModes";
import {
	MIN_CODEX_VERSION,
	meetsMinimumVersion,
	parseCodexVersion,
} from "./codexVersion";

const TEXT_DELTA_METHODS = new Set([
	"item/agentMessage/delta",
	"item/plan/delta",
	"item/reasoning/textDelta",
	"item/reasoning/summaryTextDelta",
]);

const NOTICE_METHODS: Record<string, "info" | "error" | "config_change"> = {
	warning: "info",
	configWarning: "info",
	guardianWarning: "info",
	"model/rerouted": "config_change",
	"model/verification": "info",
};

const IGNORED_METHODS = new Set([
	"thread/started",
	"deprecationNotice",
	"turn/diff/updated",
	"rawResponseItem/completed",
	"hook/started",
	"hook/completed",
	"mcpServer/startupStatus/updated",
	"remoteControl/status/changed",
	"account/updated",
	"account/rateLimits/updated",
	"app/list/updated",
	"skills/changed",
	"fs/changed",
	"model/safetyBuffering/updated",
	"item/autoApprovalReview/started",
	"item/autoApprovalReview/completed",
]);

const APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
]);

function asToolCall(item: Item | null): ToolCall | null {
	if (!item || !isKnownItem(item) || item.kind !== "tool_call") return null;
	return item;
}

type PendingApproval = {
	requestId: CodexRequestId;
	turnId: string;
	item: ApprovalRequest;
	options: CodexDecisionOption[];
};

type InFlightItem = {
	codexItem: CodexThreadItem;
	turnId: string;
	startedAtMs: number;
};

export type CodexAdapterOptions = SpawnCodexOptions & {
	minVersion?: string;
	clientVersion?: string;
	now?: () => number;
	mintId?: () => string;
	createTransport?(
		options: SpawnCodexOptions,
		handlers: CodexTransportHandlers,
	): CodexTransport;
};

export class CodexAdapter implements HarnessAdapter {
	private readonly queue = new EventQueue();
	private readonly itemText = new Map<string, string>();
	private readonly inFlight = new Map<string, InFlightItem>();
	private readonly pendingApprovals = new Map<string, PendingApproval>();
	private readonly settledTurns = new Set<string>();
	private pendingTurnStart = false;
	private cancelRequested = false;
	private readonly queuedInput: {
		input: unknown[];
		execution?: CodexExecution;
	}[] = [];
	private execution: CodexExecution | undefined;
	private goal: CodexGoal | null = null;
	private models: CodexModel[] | null = null;
	private ready: Promise<void> = Promise.resolve();
	private startupError: unknown;
	private hasHistory = false;
	private goalActivationGeneration = 0;
	private readonly questions = new Map<
		string,
		{ requestId: CodexRequestId; turnId: string; item: UserInputRequest }
	>();
	private linkedWorkspaces: LinkedWorkspace[] = [];
	private mentionedLinkedWorkspaces: string | null = null;
	private client: CodexRpcClient | null = null;
	private threadId: string | null = null;
	private cwd = process.cwd();
	private modeId: string = DEFAULT_CODEX_MODE;
	private modelId: string | undefined;
	private nativeReasoningEffort: string | undefined;
	private currentTurn: Turn | null = null;
	private usage: Turn["usage"];
	private disposed = false;

	constructor(private readonly options: CodexAdapterOptions = {}) {}

	start(startOptions: HarnessStartOptions): AsyncIterable<AdapterEvent> {
		this.cwd = startOptions.cwd;
		this.hasHistory = Boolean(startOptions.resume);
		this.modeId = startOptions.modeId ?? DEFAULT_CODEX_MODE;
		this.modelId = startOptions.modelId;
		this.execution = startOptions.execution;
		this.linkedWorkspaces = startOptions.linkedWorkspaces ?? [];
		this.ready = this.bootstrap(startOptions);
		return this.queue.iterable();
	}

	prompt(
		content: UserContent[],
		execution?: CodexExecution,
		resolvedAttachments?: ResolvedAttachment[],
	): void {
		const input = this.toCodexInput(content, resolvedAttachments);
		if (!this.threadId || !this.client) {
			this.queuedInput.push({ input, execution: execution ?? this.execution });
			return;
		}
		void this.startTurn(input, execution ?? this.execution);
	}

	cancelTurn(): void {
		if (!this.client || !this.threadId) return;
		const turn = this.currentTurn;
		if (turn?.status === "running") {
			this.interrupt(turn.id);
			return;
		}
		if (this.pendingTurnStart) this.cancelRequested = true;
	}

	private interrupt(turnId: string): void {
		this.cancelRequested = false;
		void this.client
			?.request("turn/interrupt", { threadId: this.threadId, turnId })
			.catch((error: Error) => this.emitNotice("error", error.message));
	}

	respondToApproval(approvalId: string, decision: Decision): void {
		const pending = this.pendingApprovals.get(approvalId);
		if (!pending || !this.client) return;
		this.pendingApprovals.delete(approvalId);
		this.client.respond(pending.requestId, {
			decision: codexDecision(decision, pending.options),
		});
		this.emitItem(
			{
				...pending.item,
				status: "answered",
				decision,
				completedAtMs: this.now(),
			},
			pending.turnId,
		);
	}

	setMode(modeId: string): void | Promise<void> {
		if (this.goal?.status === "active" && this.client && this.threadId) {
			return this.client
				.request("thread/resume", {
					threadId: this.threadId,
					cwd: this.cwd,
					...codexTurnPolicy(modeId),
				})
				.then(() => {
					this.modeId = modeId;
					this.emitSession({ modeId });
				});
		}
		this.modeId = modeId;
		this.emitSession({ modeId });
	}

	async setLinkedWorkspaces(
		workspaces: LinkedWorkspace[],
	): Promise<LinkedWorkspace[]> {
		this.linkedWorkspaces = workspaces;
		return workspaces;
	}

	private async requireReady(): Promise<CodexRpcClient> {
		await this.ready;
		if (this.startupError) throw this.startupError;
		if (!this.client || !this.threadId || this.disposed)
			throw new Error("Codex session is unavailable");
		return this.client;
	}
	private nativeSettings(execution: CodexExecution) {
		return {
			model: execution.modelId,
			serviceTier: execution.fast ? "priority" : "default",
			config: {
				model_reasoning_effort: execution.reasoningEffort,
			},
		};
	}
	async configureCodex(execution: CodexExecution): Promise<CodexExecution> {
		const client = await this.requireReady();
		this.models ??= await readCodexModels(client);
		const requested =
			execution.reasoningEffort === "default"
				? {
						...execution,
						reasoningEffort:
							(execution.modelId === this.modelId
								? this.nativeReasoningEffort
								: undefined) ??
							this.models.find((model) => model.model === execution.modelId)
								?.defaultReasoningEffort ??
							"",
					}
				: execution;
		const validated = validateCodexExecution(requested, this.models);
		if (
			validated.collaborationMode === "plan" &&
			this.goal?.status === "active"
		)
			await this.updateGoal({ action: "pause" });
		if (!this.hasHistory && !this.currentTurn && !this.pendingTurnStart) {
			const oldThreadId = this.threadId;
			const started = threadStartResponseSchema.parse(
				await client.request("thread/start", {
					cwd: this.cwd,
					...codexTurnPolicy(this.modeId),
					...this.nativeSettings(validated),
				}),
			);
			this.threadId = started.thread.id;
			this.emitSession({ harnessSessionId: this.threadId });
			await client.request("thread/unsubscribe", { threadId: oldThreadId });
		} else {
			await client.request("thread/resume", {
				threadId: this.threadId,
				cwd: this.cwd,
				...codexTurnPolicy(this.modeId),
				...this.nativeSettings(validated),
			});
		}
		this.execution = validated;
		this.nativeReasoningEffort = validated.reasoningEffort;
		this.modelId = validated.modelId;
		this.emitSession({ execution: validated, modelId: validated.modelId });
		return validated;
	}
	async updateGoal(change: CodexGoalAction): Promise<void> {
		const generation = ++this.goalActivationGeneration;
		const client = await this.requireReady();
		if (change.action === "resume" && this.goal?.status === "complete")
			throw new Error("This goal is already complete");
		if (change.action === "set" || change.action === "resume") {
			if (!this.execution)
				throw new Error("Configure a Codex model before starting a goal");
			if (this.execution.collaborationMode === "plan")
				await this.configureCodex({
					...this.execution,
					collaborationMode: "default",
				});
			const paused = await client.request("thread/goal/set", {
				threadId: this.threadId,
				status: "paused",
				...(change.action === "set" ? { objective: change.objective } : {}),
			});
			if (generation !== this.goalActivationGeneration || this.disposed) return;
			this.goal = z
				.object({ goal: codexGoalSchema.nullable() })
				.parse(paused).goal;
			this.emitSession({ goal: this.goal });
			this.cancelTurn();
			const deadline = Date.now() + 10000;
			while (this.currentTurn?.status === "running") {
				if (this.disposed || Date.now() > deadline)
					throw new Error(
						"Codex is still stopping. Retry when the turn finishes.",
					);
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			if (generation !== this.goalActivationGeneration || this.disposed) return;
			const text =
				change.action === "set"
					? change.objective
					: `Continue working toward the existing goal: ${this.goal?.objective ?? ""}`;
			const started = await this.startTurn(
				this.toCodexInput([{ type: "text", text }]),
				{ ...this.execution, collaborationMode: "default" },
			);
			if (!started) throw new Error("Could not start the goal turn");
			if (generation !== this.goalActivationGeneration || this.disposed) return;
			const response = await client.request("thread/goal/set", {
				threadId: this.threadId,
				status: "active",
			});
			if (generation !== this.goalActivationGeneration || this.disposed) return;
			this.goal = z
				.object({ goal: codexGoalSchema.nullable() })
				.parse(response).goal;
		} else {
			const response = await client.request(
				change.action === "clear" ? "thread/goal/clear" : "thread/goal/set",
				{
					threadId: this.threadId,
					...(change.action === "pause" ? { status: "paused" } : {}),
				},
			);
			this.goal =
				change.action === "clear"
					? null
					: z.object({ goal: codexGoalSchema.nullable() }).parse(response).goal;
			this.cancelTurn();
		}
		this.emitSession({ goal: this.goal });
	}

	respondToUserInput(requestId: string, answers: UserInputAnswers): void {
		const pending = this.questions.get(requestId);
		if (!pending || !this.client) throw new Error("This question has expired");
		for (const question of pending.item.questions) {
			const values = answers[question.id];
			if (!values?.length || values.some((value) => !value.trim()))
				throw new Error("Answer every question");
			if (
				question.options &&
				!question.isOther &&
				values.some(
					(value) =>
						!question.options?.some((option) => option.label === value),
				)
			)
				throw new Error("Choose one of the offered answers");
		}
		this.client.respond(pending.requestId, {
			answers: Object.fromEntries(
				pending.item.questions.map((question) => [
					question.id,
					{ answers: answers[question.id] },
				]),
			),
		});
		this.questions.delete(requestId);
		this.emitItem(
			{ ...pending.item, status: "answered", completedAtMs: this.now() },
			pending.turnId,
		);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;

		this.disposed = true;
		this.goalActivationGeneration += 1;
		this.stalePendingApprovals();
		await this.client?.close();
		this.queue.close();
	}

	private async bootstrap(startOptions: HarnessStartOptions): Promise<void> {
		this.emitSession({ status: "starting" });
		try {
			const client = new CodexRpcClient({
				clientVersion: this.options.clientVersion,
				createTransport: (handlers) =>
					(this.options.createTransport ?? spawnCodexTransport)(
						{
							command: this.options.command,
							args: this.options.args,
							cwd: startOptions.cwd,
							env: this.options.env,
						},
						handlers,
					),
				onNotification: (notification) => this.handleNotification(notification),
				onServerRequest: (request) => this.handleServerRequest(request),
				onDispatchError: (error, method) =>
					this.emitNotice(
						"error",
						`codex ${method} could not be read: ${error instanceof Error ? error.message : String(error)}`,
					),
				onExit: (code) => this.handleExit(code),
			});
			this.client = client;

			const initialize = await client.initialize();
			const version = parseCodexVersion(initialize.userAgent);
			const minimum = this.options.minVersion ?? MIN_CODEX_VERSION;
			if (!meetsMinimumVersion(version, minimum)) {
				this.emitNotice(
					"error",
					`codex ${version ?? "of an unknown version"} is not supported: upgrade to ${minimum} or newer`,
				);
				this.emitSession({ status: "dead" });
				await client.close();
				this.queue.close();
				return;
			}

			if (startOptions.resume) {
				try {
					const response = await client.request("thread/goal/get", {
						threadId: startOptions.resume.harnessSessionId,
					});
					this.goal = z
						.object({ goal: codexGoalSchema.nullable() })
						.parse(response).goal;
					if (this.goal?.status === "active") {
						const paused = await client.request("thread/goal/set", {
							threadId: startOptions.resume.harnessSessionId,
							status: "paused",
						});
						this.goal = z
							.object({ goal: codexGoalSchema.nullable() })
							.parse(paused).goal;
					}
				} catch (error) {
					const unsupported =
						error instanceof CodexRpcError &&
						(error.rpcError.code === -32601 ||
							/unknown (?:variant|method)|method not found/i.test(
								error.rpcError.message,
							));
					if (!unsupported || startOptions.goal || this.goal) throw error;
				}
			}
			if (this.execution) {
				this.models = await readCodexModels(client);
				validateCodexExecution(this.execution, this.models);
			}
			const policy = {
				...codexTurnPolicy(this.modeId),
				...(this.execution ? this.nativeSettings(this.execution) : {}),
			};
			const response = startOptions.resume
				? await client.request("thread/resume", {
						threadId: startOptions.resume.harnessSessionId,
						cwd: startOptions.cwd,
						...policy,
					})
				: await client.request("thread/start", {
						cwd: startOptions.cwd,
						...policy,
						...(this.execution
							? {}
							: this.modelId
								? { model: this.modelId }
								: {}),
					});
			const thread = threadStartResponseSchema.parse(response);
			this.threadId = thread.thread.id;
			this.modelId = thread.model ?? this.modelId;
			this.nativeReasoningEffort =
				thread.reasoningEffort ?? this.execution?.reasoningEffort;

			this.emitSession({
				status: "idle",
				harnessSessionId: this.threadId,
				modeId: this.modeId,
				availableModes: [...CODEX_MODES],
				...(thread.reasoningEffort
					? { reasoningEffort: thread.reasoningEffort }
					: {}),
				...(thread.serviceTier ? { serviceTier: thread.serviceTier } : {}),
				...(this.execution ? { execution: this.execution } : {}),
				...(startOptions.resume ? { goal: this.goal } : {}),
				...(this.modelId ? { modelId: this.modelId } : {}),
			});

			const queued = this.queuedInput.splice(0, this.queuedInput.length);
			for (const entry of queued)
				await this.startTurn(entry.input, entry.execution);
		} catch (error) {
			this.startupError = error;
			this.emitNotice("error", (error as Error).message);
			this.emitSession({ status: "dead" });
			this.queue.close();
		}
	}

	private async startTurn(
		input: unknown[],
		execution?: CodexExecution,
	): Promise<boolean> {
		const client = this.client;
		if (!client || !this.threadId) return false;
		this.hasHistory = true;
		this.pendingTurnStart = true;
		try {
			if (execution) {
				this.models ??= await readCodexModels(client);
				validateCodexExecution(execution, this.models);
			}
			const response = await client.request("turn/start", {
				threadId: this.threadId,
				input: [...this.linkedWorkspaceMentions(), ...input],
				approvalPolicy: codexTurnPolicy(this.modeId).approvalPolicy,
				sandboxPolicy: codexSandboxPolicy(
					this.modeId,
					this.cwd,
					this.linkedWorkspaces.map((workspace) => workspace.path),
				),
				...(execution
					? {
							model: execution.modelId,
							effort: execution.reasoningEffort,
							serviceTier: execution.fast ? "priority" : "default",
							collaborationMode: {
								mode: execution.collaborationMode,
								settings: {
									model: execution.modelId,
									reasoning_effort: execution.reasoningEffort,
									developer_instructions: null,
								},
							},
						}
					: this.modelId
						? { model: this.modelId }
						: {}),
			});
			const parsed = turnLifecycleSchema
				.partial({ threadId: true })
				.safeParse(response);
			if (parsed.success && parsed.data.turn) this.emitTurn(parsed.data.turn);
			return !parsed.success || parsed.data.turn?.status !== "failed";
		} catch (error) {
			this.emitNotice("error", (error as Error).message);
			this.emitTurnState({
				id: this.mintId(),
				status: "failed",
				error: { message: (error as Error).message },
				startedAtMs: this.now(),
				completedAtMs: this.now(),
			});
			return false;
		}
	}

	private handleNotification({ method, params }: CodexNotification): void {
		if (
			this.threadId &&
			params &&
			typeof params === "object" &&
			"threadId" in params &&
			typeof params.threadId === "string" &&
			params.threadId !== this.threadId
		)
			return;
		if (IGNORED_METHODS.has(method)) return;
		if (method === "thread/goal/updated" || method === "thread/goal/cleared") {
			this.goal =
				method === "thread/goal/cleared"
					? null
					: z.object({ goal: codexGoalSchema }).parse(params).goal;
			this.emitSession({ goal: this.goal });
			return;
		}

		if (method === "item/started" || method === "item/completed") {
			this.handleItemLifecycle(method, params);
			return;
		}
		if (TEXT_DELTA_METHODS.has(method)) {
			const delta = itemDeltaSchema.parse(params);
			this.itemText.set(
				delta.itemId,
				(this.itemText.get(delta.itemId) ?? "") + delta.delta,
			);
			this.emit({
				kind: "delta",
				delta: { type: "text", itemId: delta.itemId, append: delta.delta },
			});
			return;
		}
		if (method === "item/commandExecution/outputDelta") {
			const delta = itemDeltaSchema.parse(params);
			this.emit({
				kind: "delta",
				delta: { type: "terminal", itemId: delta.itemId, append: delta.delta },
			});
			return;
		}
		if (method === "turn/started" || method === "turn/completed") {
			const lifecycle = turnLifecycleSchema.parse(params);
			if (method === "turn/completed") {
				this.settleInFlight(lifecycle.turn);
			}
			this.emitTurn(lifecycle.turn);
			return;
		}
		if (method === "thread/tokenUsage/updated") {
			const update = tokenUsageUpdatedSchema.parse(params);
			this.usage = {
				inputTokens: update.tokenUsage.last.inputTokens,
				cachedInputTokens: update.tokenUsage.last.cachedInputTokens,
				outputTokens: update.tokenUsage.last.outputTokens,
				contextUsed: update.tokenUsage.total.totalTokens,
				...(update.tokenUsage.modelContextWindow == null
					? {}
					: { contextSize: update.tokenUsage.modelContextWindow }),
			};
			if (this.currentTurn) this.emitTurnState(this.currentTurn);
			return;
		}
		if (method === "turn/plan/updated") {
			const update = planUpdatedSchema.parse(params);
			this.emitItem(
				{
					id: `plan:${update.turnId}`,
					kind: "plan",
					startedAtMs: this.now(),
					entries: update.plan.map((step) => ({
						text: step.step,
						status: step.status === "inProgress" ? "in_progress" : step.status,
					})),
				},
				update.turnId,
			);
			return;
		}
		if (method === "thread/status/changed") {
			const update = threadStatusChangedSchema.parse(params);
			this.emitSession({ status: this.sessionStatus(update.status) });
			return;
		}
		if (method === "thread/settings/updated") {
			const settings = params as { threadSettings?: { model?: string } };
			const model = settings.threadSettings?.model;
			if (model && model !== this.modelId) {
				this.modelId = model;
				this.emitSession({ modelId: model });
			}
			return;
		}
		if (method === "thread/name/updated") {
			const update = params as { name?: string };
			if (update.name) this.emitSession({ title: update.name });
			return;
		}
		if (method === "error") {
			const notification = errorNotificationSchema.parse(params);
			this.emitNotice("error", notification.error.message);
			return;
		}
		if (method === "thread/compacted") {
			this.emitNotice("compaction");
			return;
		}
		if (method === "serverRequest/resolved") {
			const resolved = serverRequestResolvedSchema.parse(params);
			this.staleApprovalForRequest(resolved.requestId);
			return;
		}
		const noticeKind = NOTICE_METHODS[method];
		if (noticeKind) {
			const parsed = warningNotificationSchema.safeParse(params);
			this.emitNotice(
				noticeKind,
				parsed.success ? parsed.data.message : method,
			);
			return;
		}
		this.emitNotice("info", `Unmapped codex notification: ${method}`);
	}

	private handleItemLifecycle(method: string, params: unknown): void {
		const lifecycle = itemLifecycleSchema.parse(params);
		const completed = method === "item/completed";
		const startedAtMs =
			lifecycle.startedAtMs ??
			this.inFlight.get(lifecycle.item.id)?.startedAtMs ??
			this.now();

		if (completed) {
			this.inFlight.delete(lifecycle.item.id);
			this.itemText.delete(lifecycle.item.id);
		} else {
			this.inFlight.set(lifecycle.item.id, {
				codexItem: lifecycle.item,
				turnId: lifecycle.turnId,
				startedAtMs,
			});
		}

		const item = mapThreadItem(lifecycle.item, {
			cwd: this.cwd,
			startedAtMs,
			...(completed
				? { completedAtMs: lifecycle.completedAtMs ?? this.now() }
				: {}),
		});
		if (item) this.emitItem(item, lifecycle.turnId);
	}

	private handleServerRequest(request: CodexServerRequest): void {
		const client = this.client;
		if (!client) return;
		if (request.method === "item/tool/requestUserInput") {
			const parsed = z
				.object({
					turnId: z.string(),
					itemId: z.string(),
					questions: userInputRequestSchema.shape.questions,
					isBlocking: z.boolean().default(true),
				})
				.parse(request.params);
			const item: UserInputRequest = {
				id: `question:${parsed.turnId}:${parsed.itemId}:${request.id}`,
				kind: "user_input_request",
				status: "pending",
				startedAtMs: this.now(),
				questions: parsed.questions,
				isBlocking: parsed.isBlocking,
			};
			this.questions.set(item.id, {
				requestId: request.id,
				turnId: parsed.turnId,
				item,
			});
			this.emitItem(item, parsed.turnId);
			if (item.isBlocking) this.emitSession({ status: "awaiting_input" });
			return;
		}
		if (!APPROVAL_METHODS.has(request.method)) {
			client.respondWithError(
				request.id,
				`unsupported by superset chat runtime: ${request.method}`,
			);
			this.emitNotice(
				"info",
				`Unmapped codex request: ${request.method} (declined)`,
			);
			return;
		}

		const isCommand =
			request.method === "item/commandExecution/requestApproval";
		const params = isCommand
			? commandApprovalParamsSchema.parse(request.params)
			: fileChangeApprovalParamsSchema.parse(request.params);
		const suffix =
			isCommand && "approvalId" in params && params.approvalId
				? `:${params.approvalId}`
				: "";
		const approvalItemId = `approval:${params.itemId}${suffix}`;
		const options = decisionOptions(
			(request.params as { availableDecisions?: unknown }).availableDecisions,
		);
		const detail = this.approvalDetail(isCommand, params.itemId);

		const item: ApprovalRequest = {
			id: approvalItemId,
			kind: "approval_request",
			targetItemId: params.itemId,
			title: params.reason ?? this.approvalFallbackTitle(isCommand, params),
			status: "pending",
			startedAtMs: params.startedAtMs ?? this.now(),
			...(detail.length > 0 ? { detail } : {}),
			...(options.length > 0
				? {
						options: options.map(({ optionId, label }) => ({
							optionId,
							label,
						})),
					}
				: {}),
		};

		this.pendingApprovals.set(approvalItemId, {
			requestId: request.id,
			turnId: params.turnId,
			item,
			options,
		});
		this.emitItem(item, params.turnId);
		this.emitSession({ status: "awaiting_input" });
	}

	private approvalDetail(
		isCommand: boolean,
		itemId: string,
	): ApprovalRequest["detail"] & object {
		const pending = this.inFlight.get(itemId);
		if (!pending) return [];
		const mapped = mapThreadItem(pending.codexItem, {
			cwd: this.cwd,
			startedAtMs: pending.startedAtMs,
		});
		const toolCall = asToolCall(mapped);
		if (!toolCall) return [];
		const content = toolCall.content;
		return isCommand
			? content.filter((entry) => entry.type === "terminal")
			: content;
	}

	private approvalFallbackTitle(
		isCommand: boolean,
		params: { itemId: string },
	): string {
		const pending = this.inFlight.get(params.itemId);
		const mapped = pending
			? mapThreadItem(pending.codexItem, {
					cwd: this.cwd,
					startedAtMs: pending.startedAtMs,
				})
			: null;
		const toolCall = asToolCall(mapped);
		if (toolCall) return toolCall.title;
		return isCommand ? "Run command" : "Apply file change";
	}

	private settleInFlight(turn: CodexTurn): void {
		const settledAtMs = this.now();
		const status = turn.status === "failed" ? "failed" : "canceled";

		for (const [itemId, pending] of [...this.inFlight]) {
			this.inFlight.delete(itemId);
			const accumulated = this.itemText.get(itemId);
			this.itemText.delete(itemId);
			const item = mapThreadItem(
				this.withAccumulatedText(pending.codexItem, accumulated),
				{
					cwd: this.cwd,
					startedAtMs: pending.startedAtMs,
					completedAtMs: settledAtMs,
				},
			);
			if (!item) continue;
			const toolCall = asToolCall(item);
			this.emitItem(toolCall ? { ...toolCall, status } : item, pending.turnId);
		}
		this.stalePendingApprovals(turn.status !== "completed");
	}

	private withAccumulatedText(
		codexItem: CodexThreadItem,
		accumulated: string | undefined,
	): CodexThreadItem {
		if (!accumulated) return codexItem;
		if (codexItem.type === "agentMessage" || codexItem.type === "plan") {
			return { ...codexItem, text: accumulated };
		}
		if (codexItem.type === "reasoning") {
			return { ...codexItem, content: [accumulated] };
		}
		return codexItem;
	}

	private stalePendingApprovals(expireNonBlocking = true): void {
		for (const [id, pending] of this.questions) {
			if (!expireNonBlocking && !pending.item.isBlocking) continue;
			this.questions.delete(id);
			this.emitItem(
				{ ...pending.item, status: "stale", completedAtMs: this.now() },
				pending.turnId,
			);
		}
		for (const [approvalId, pending] of [...this.pendingApprovals]) {
			this.pendingApprovals.delete(approvalId);
			this.emitItem(
				{ ...pending.item, status: "stale", completedAtMs: this.now() },
				pending.turnId,
			);
		}
	}

	private staleApprovalForRequest(requestId: CodexRequestId): void {
		for (const [id, pending] of this.questions)
			if (pending.requestId === requestId) {
				this.questions.delete(id);
				this.emitItem({ ...pending.item, status: "stale" }, pending.turnId);
			}
		for (const [approvalId, pending] of [...this.pendingApprovals]) {
			if (pending.requestId !== requestId) continue;
			this.pendingApprovals.delete(approvalId);
			this.emitItem(
				{ ...pending.item, status: "stale", completedAtMs: this.now() },
				pending.turnId,
			);
		}
	}

	private handleExit(code: number | null): void {
		if (this.disposed) return;
		this.stalePendingApprovals();
		this.emitNotice(
			"error",
			`codex app-server exited (code ${code ?? "null"})`,
		);
		this.emitSession({ status: "dead" });
		this.queue.close();
	}

	private sessionStatus(status: { type: string }): SessionState["status"] {
		switch (status.type) {
			case "notLoaded":
				return "not_loaded";
			case "systemError":
				return "dead";
			case "active":
				return this.pendingApprovals.size > 0 ||
					[...this.questions.values()].some((entry) => entry.item.isBlocking)
					? "awaiting_input"
					: "running";
			default:
				return "idle";
		}
	}

	private emitTurn(codexTurn: CodexTurn): void {
		this.emitTurnState({
			id: codexTurn.id,
			status: codexTurn.status === "inProgress" ? "running" : codexTurn.status,
			...(codexTurn.error
				? { error: { message: codexTurn.error.message } }
				: {}),
			startedAtMs: codexTurn.startedAt
				? codexTurn.startedAt * 1000
				: (this.currentTurn?.startedAtMs ?? this.now()),
			...(codexTurn.completedAt
				? { completedAtMs: codexTurn.completedAt * 1000 }
				: {}),
		});
	}

	private emitTurnState(turn: Turn): void {
		if (turn.status === "running" && this.settledTurns.has(turn.id)) return;
		if (turn.status !== "running") this.settledTurns.add(turn.id);
		const next: Turn = {
			...turn,
			...(this.usage ? { usage: this.usage } : {}),
		};
		this.currentTurn = next;
		this.emit({ kind: "turn", turn: next });

		this.pendingTurnStart = false;
		if (turn.status !== "running") {
			this.cancelRequested = false;
			return;
		}
		if (this.cancelRequested) this.interrupt(turn.id);
	}

	// Codex only learns about a linked workspace from a mention, and a mention
	// repeated every turn is noise, so they ride the first turn after a change.
	private linkedWorkspaceMentions(): unknown[] {
		const signature = JSON.stringify(
			this.linkedWorkspaces.map((workspace) => [
				workspace.name,
				workspace.path,
			]),
		);
		if (signature === this.mentionedLinkedWorkspaces) return [];
		this.mentionedLinkedWorkspaces = signature;
		return this.linkedWorkspaces.map((workspace) => ({
			type: "mention",
			name: workspace.name,
			path: workspace.path,
		}));
	}

	private toCodexInput(
		content: UserContent[],
		resolvedAttachments: ResolvedAttachment[] = [],
	): unknown[] {
		const resolved = new Map(
			resolvedAttachments.map((attachment) => [
				attachment.attachmentId,
				attachment,
			]),
		);
		const input: unknown[] = [];
		const unresolved: string[] = [];
		for (const entry of content) {
			if (entry.type === "text") {
				input.push({
					type: "text",
					text: entry.text,
					text_elements: (entry.elements ?? []).map((element) => ({
						byteRange: element.byteRange,
						placeholder: null,
					})),
				});
				continue;
			}
			const attachment = resolved.get(entry.attachmentId);
			if (!attachment) {
				unresolved.push(entry.name);
				continue;
			}
			input.push(
				attachment.mimeType.startsWith("image/")
					? { type: "localImage", path: attachment.path }
					: { type: "mention", name: entry.name, path: attachment.path },
			);
		}
		if (unresolved.length > 0) {
			this.emitNotice(
				"info",
				`These attachments could not be read and were omitted: ${unresolved.join(", ")}`,
			);
		}
		return input;
	}

	private emitItem(item: Item, turnId: string): void {
		this.emit({ kind: "item", item, turnId });
	}

	private emitNotice(
		noticeKind: "info" | "error" | "compaction" | "config_change",
		text?: string,
	): void {
		this.emitItem(
			{
				id: this.mintId(),
				kind: "notice",
				noticeKind,
				startedAtMs: this.now(),
				completedAtMs: this.now(),
				...(text ? { text } : {}),
			},
			this.currentTurn?.id ?? "codex:session",
		);
	}

	private emitSession(session: Partial<SessionState>): void {
		this.emit({ kind: "session", session });
	}

	private emit(event: AdapterEvent): void {
		this.queue.push(event);
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private mintId(): string {
		return (this.options.mintId ?? randomUUID)();
	}
}

export function createCodexAdapter(
	options: CodexAdapterOptions = {},
): HarnessAdapter {
	return new CodexAdapter(options);
}
