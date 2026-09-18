import { randomUUID } from "node:crypto";
import type {
	CodexExecution,
	CodexGoalAction,
	DurableEvent,
	Envelope,
	LinkedWorkspace,
	SessionState,
	Turn,
	UserContent,
	UserInputAnswers,
	UserMessage,
} from "@superset/chat/protocol";
import { sessionStateSchema } from "@superset/chat/protocol";
import type {
	AdapterEvent,
	HarnessAdapter,
	HarnessStartOptions,
	ResolvedAttachment,
} from "../../harness";
import type { ChatJournal } from "../../journal";

export type LiveSessionOptions = {
	sessionId: string;
	scopeId: string;
	harness: string;
	title?: string;
	journal: ChatJournal;
	publish: (envelope: Envelope) => void;
	adapter: HarnessAdapter;
	mintId?: () => string;
	now?: () => number;
};

export type PromptResult = {
	itemId: string;
	queued: boolean;
};

type PendingPrompt = {
	item: UserMessage;
	content: UserContent[];
	execution?: CodexExecution;
	resolvedAttachments?: ResolvedAttachment[];
};

function withoutQueued(item: UserMessage): UserMessage {
	const next = { ...item };
	delete next.queued;
	return next;
}

export class LiveSession {
	private readonly queue: PendingPrompt[] = [];
	private awaitingTurn: PendingPrompt | null = null;
	private sessionState: SessionState;
	private currentTurn: Turn | null = null;
	private pump: Promise<void> | null = null;
	private stopped = false;

	constructor(private readonly options: LiveSessionOptions) {
		this.sessionState = {
			status: "starting",
			harness: options.harness,
			...(options.title ? { title: options.title } : {}),
		};
	}

	get sessionId(): string {
		return this.options.sessionId;
	}

	get state(): SessionState {
		return this.sessionState;
	}

	get turn(): Turn | null {
		return this.currentTurn;
	}

	get queuedCount(): number {
		return this.queue.length;
	}

	start(startOptions: HarnessStartOptions): void {
		this.emitSession({
			status: "starting",
			...(startOptions.linkedWorkspaces
				? { linkedWorkspaces: startOptions.linkedWorkspaces }
				: {}),
		});
		this.pump = this.run(this.options.adapter.start(startOptions)).catch(
			(error: unknown) => {
				try {
					this.fail(error);
				} catch {
					this.stopped = true;
				}
			},
		);
	}

	prompt(
		content: UserContent[],
		clientId: string,
		execution?: CodexExecution,
		resolvedAttachments?: ResolvedAttachment[],
	): PromptResult {
		const captured = execution ?? this.sessionState.execution;
		if (this.options.harness === "codex" && !this.sessionState.title) {
			const text = content.find((part) => part.type === "text");
			if (text?.type === "text")
				this.emitSession({
					title: text.text.trim().replace(/\s+/g, " ").slice(0, 80),
				});
		}
		const itemId = this.mintId();
		const queued = this.isBusy();
		const item: UserMessage = {
			id: itemId,
			kind: "user_message",
			clientId,
			startedAtMs: this.now(),
			content,
			...(queued ? { queued: true } : {}),
		};
		this.appendDurable({ type: "item", item, turnId: this.mintId() });

		if (queued) {
			this.queue.push({
				item,
				content,
				execution: captured,
				resolvedAttachments,
			});
			return { itemId, queued: true };
		}
		this.deliver({ item, content, execution: captured, resolvedAttachments });
		return { itemId, queued: false };
	}

	cancelTurn(turnId?: string): void {
		if (turnId && this.currentTurn && this.currentTurn.id !== turnId) return;
		this.options.adapter.cancelTurn();
	}

	respondToApproval(
		approvalId: string,
		decision: Parameters<HarnessAdapter["respondToApproval"]>[1],
	): void {
		this.options.adapter.respondToApproval(approvalId, decision);
	}

	async configureCodex(execution: CodexExecution): Promise<CodexExecution> {
		if (!this.options.adapter.configureCodex)
			throw new Error("Codex configuration is not supported by this session");
		const configured = await this.options.adapter.configureCodex(execution);
		if (this.stopped) throw new Error("Chat session stopped");
		const applied = configured;
		this.emitSession({ execution: applied });
		return applied;
	}
	async setLinkedWorkspaces(
		workspaces: LinkedWorkspace[],
	): Promise<LinkedWorkspace[]> {
		if (!this.options.adapter.setLinkedWorkspaces)
			throw new Error("Linked workspaces are not supported by this session");
		const applied = await this.options.adapter.setLinkedWorkspaces(workspaces);
		if (this.stopped) throw new Error("Chat session stopped");
		this.emitSession({ linkedWorkspaces: applied });
		return applied;
	}
	async updateGoal(change: CodexGoalAction): Promise<void> {
		if (!this.options.adapter.updateGoal)
			throw new Error("Goals are not supported by this session");
		const startedAtMs = this.now();
		await this.options.adapter.updateGoal(change);
		if (this.stopped) throw new Error("Chat session stopped");
		if (change.action === "set") {
			const id = this.mintId();
			this.appendDurable({
				type: "item",
				turnId: `goal:${id}`,
				item: {
					id,
					kind: "user_message",
					startedAtMs,
					content: [{ type: "text", text: change.objective }],
				},
			});
		}
		if (change.action === "set" && !this.sessionState.title)
			this.emitSession({ title: change.objective.slice(0, 80) });
	}
	respondToUserInput(requestId: string, answers: UserInputAnswers): void {
		if (!this.options.adapter.respondToUserInput)
			throw new Error("Questions are not supported by this session");
		this.options.adapter.respondToUserInput(requestId, answers);
	}

	setMode(modeId: string): void | Promise<void> {
		return this.options.adapter.setMode(modeId);
	}

	async dispose(): Promise<void> {
		this.stopped = true;
		await this.options.adapter.dispose();
		await this.pump;
	}

	private async run(stream: AsyncIterable<AdapterEvent>): Promise<void> {
		for await (const event of stream) {
			if (this.stopped) return;
			this.handle(event);
		}
	}

	private handle(event: AdapterEvent): void {
		switch (event.kind) {
			case "item":
				this.appendDurable({
					type: "item",
					item: event.item,
					turnId: event.turnId,
				});
				return;
			case "turn": {
				this.currentTurn = event.turn;
				this.appendDurable({ type: "turn", turn: event.turn });
				if (event.turn.status === "running") {
					this.attributeAwaitingPrompt(event.turn.id);
				} else {
					this.deliverNextQueued();
				}
				return;
			}
			case "session":
				this.emitSession(event.session);
				return;
			case "delta":
				this.options.publish({
					v: 1,
					sessionId: this.options.sessionId,
					ts: this.now(),
					delta: event.delta,
				});
				return;
		}
	}

	private attributeAwaitingPrompt(turnId: string): void {
		const awaiting = this.awaitingTurn;
		if (!awaiting) return;
		this.awaitingTurn = null;
		this.appendDurable({
			type: "item",
			item: withoutQueued(awaiting.item),
			turnId,
		});
	}

	private deliver(prompt: PendingPrompt): void {
		this.awaitingTurn = prompt;
		try {
			this.options.adapter.prompt(
				prompt.content,
				prompt.execution,
				prompt.resolvedAttachments,
			);
		} catch (error) {
			this.awaitingTurn = null;
			throw error;
		}
	}

	private fail(error: unknown): void {
		this.stopped = true;
		const failedAtMs = this.now();
		const turn = this.currentTurn;
		if (turn?.status === "running") {
			this.currentTurn = {
				...turn,
				status: "interrupted",
				completedAtMs: failedAtMs,
			};
			this.appendDurable({ type: "turn", turn: this.currentTurn });
		}
		this.queue.length = 0;
		this.awaitingTurn = null;
		this.appendDurable({
			type: "item",
			item: {
				id: this.mintId(),
				kind: "notice",
				noticeKind: "error",
				text: error instanceof Error ? error.message : String(error),
				startedAtMs: failedAtMs,
				completedAtMs: failedAtMs,
			},
			turnId: turn?.id ?? this.mintId(),
		});
		this.emitSession({ status: "dead" });
	}

	private deliverNextQueued(): void {
		const next = this.queue.shift();
		if (!next) return;
		this.deliver(next);
	}

	private emitSession(partial: Partial<SessionState>): void {
		const merged: SessionState = { ...this.sessionState, ...partial };
		const status =
			merged.status === "dead" || merged.status === "awaiting_input"
				? merged.status
				: this.hasPendingWork()
					? "running"
					: merged.status;
		this.sessionState = sessionStateSchema.parse({ ...merged, status });
		this.appendDurable({ type: "session", session: this.sessionState });
	}

	private appendDurable(event: DurableEvent): void {
		this.options.publish(
			this.options.journal.appendEnvelope(this.options.sessionId, event),
		);
	}

	private hasPendingWork(): boolean {
		return this.queue.length > 0 || this.awaitingTurn !== null;
	}

	private isBusy(): boolean {
		return this.currentTurn?.status === "running" || this.hasPendingWork();
	}

	private mintId(): string {
		return (this.options.mintId ?? randomUUID)();
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}
}
