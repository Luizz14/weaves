import { randomUUID } from "node:crypto";
import type {
	CancelTurnInput,
	CodexExecution,
	ConfigureCodexInput,
	Cursor,
	GetItemsInput,
	GetSessionInput,
	LinkedWorkspace,
	RespondToApprovalInput,
	RespondToUserInput,
	SessionState,
	SetModeInput,
	UpdateCodexGoalInput,
} from "@superset/chat/protocol";
import {
	cancelTurnInputSchema,
	configureCodexInputSchema,
	createSessionInputSchema,
	getItemsInputSchema,
	getSessionInputSchema,
	linkedWorkspaceSchema,
	listSessionsInputSchema,
	promptInputSchema,
	respondToApprovalInputSchema,
	respondToUserInputSchema,
	setLinkedWorkspacesInputSchema,
	setModeInputSchema,
	steerInputSchema,
	updateCodexGoalInputSchema,
} from "@superset/chat/protocol";
import { z } from "zod";
import type { ChatDb, ChatSessionRow } from "../../db";
import type { ChatJournal } from "../../journal";
import type { ChatSessionStore } from "../../projection";
import type { PageResult } from "../../replay";
import { readLatestSessionState, readPage } from "../../replay";
import type { LiveSessionRegistry, PromptResult } from "../../sessions";

export const createSessionCommandSchema = createSessionInputSchema
	.omit({ workspaceId: true })
	.extend({ scopeId: z.string().min(1), cwd: z.string().min(1) });
export type CreateSessionCommandInput = z.input<
	typeof createSessionCommandSchema
>;

export const listSessionsCommandSchema = listSessionsInputSchema
	.omit({ workspaceId: true })
	.extend({ scopeId: z.string().min(1).optional() });
export type ListSessionsCommandInput = z.input<
	typeof listSessionsCommandSchema
>;

export const resolvedAttachmentSchema = z.object({
	attachmentId: z.string().min(1),
	path: z.string().min(1),
	mimeType: z.string().min(1),
});

// Host paths stay out of the journalled `user_message` content: clients read
// those items, and an attachment's location on the host is not theirs to see.
export const promptCommandInputSchema = promptInputSchema.extend({
	resolvedAttachments: z.array(resolvedAttachmentSchema).optional(),
});
export type PromptCommandInput = z.infer<typeof promptCommandInputSchema>;

export const steerCommandInputSchema = steerInputSchema.extend({
	resolvedAttachments: z.array(resolvedAttachmentSchema).optional(),
});
export type SteerCommandInput = z.infer<typeof steerCommandInputSchema>;

export const setLinkedWorkspacesCommandSchema = setLinkedWorkspacesInputSchema
	.omit({ workspaceIds: true })
	.extend({ workspaces: z.array(linkedWorkspaceSchema).max(10) });
export type SetLinkedWorkspacesCommandInput = z.infer<
	typeof setLinkedWorkspacesCommandSchema
>;

export type CreateSessionResult = {
	sessionId: string;
	epoch: string;
};

export type GetSessionResult = {
	session: ChatSessionRow | null;
	isLive?: boolean;
	state?: SessionState | null;
	cursor: Cursor | null;
};

export type ChatCommands = {
	configureCodex(input: ConfigureCodexInput): Promise<CodexExecution>;
	updateCodexGoal(input: UpdateCodexGoalInput): Promise<void>;
	respondToUserInput(input: RespondToUserInput): void;
	setLinkedWorkspaces(
		input: SetLinkedWorkspacesCommandInput,
	): Promise<LinkedWorkspace[]>;
	createSession(input: CreateSessionCommandInput): CreateSessionResult;
	prompt(input: PromptCommandInput): PromptResult;
	cancelTurn(input: CancelTurnInput): void;
	respondToApproval(input: RespondToApprovalInput): void;
	setMode(input: SetModeInput): void | Promise<void>;
	getSession(input: GetSessionInput): GetSessionResult;
	listSessions(input: ListSessionsCommandInput): ChatSessionRow[];
	getItems(input: z.input<typeof getItemsInputSchema>): PageResult;
};

export type CommandsOptions = {
	journal: ChatJournal;
	db: ChatDb;
	sessions: ChatSessionStore;
	live: LiveSessionRegistry;
	dedupe: { run<T>(commandId: string, execute: () => T): T };
	mintSessionId?: () => string;
};

export function createCommands(options: CommandsOptions): ChatCommands {
	const mintSessionId = options.mintSessionId ?? randomUUID;

	const listSessions = (input: ListSessionsCommandInput): ChatSessionRow[] => {
		const parsed = listSessionsCommandSchema.parse(input);
		const rows = parsed.scopeId
			? options.sessions.listByScope(parsed.scopeId)
			: options.sessions.list();
		return rows
			.filter(
				(row) => parsed.harness === undefined || row.harness === parsed.harness,
			)
			.slice(0, parsed.limit);
	};

	return {
		configureCodex(input) {
			const parsed = configureCodexInputSchema.parse(input);
			return options.dedupe.run(`configure:${parsed.commandId}`, () =>
				options.live.require(parsed.sessionId).configureCodex(parsed.execution),
			);
		},
		updateCodexGoal(input) {
			const parsed = updateCodexGoalInputSchema.parse(input);
			return options.dedupe.run(`goal:${parsed.commandId}`, () =>
				options.live.require(parsed.sessionId).updateGoal(parsed.change),
			);
		},
		respondToUserInput(input) {
			const parsed = respondToUserInputSchema.parse(input);
			options.dedupe.run(`answer:${parsed.commandId}`, () =>
				options.live
					.require(parsed.sessionId)
					.respondToUserInput(parsed.requestId, parsed.answers),
			);
		},
		setLinkedWorkspaces(input) {
			const parsed = setLinkedWorkspacesCommandSchema.parse(input);
			return options.dedupe.run(`linkedWorkspaces:${parsed.commandId}`, () =>
				options.live
					.require(parsed.sessionId)
					.setLinkedWorkspaces(parsed.workspaces),
			);
		},
		createSession(input) {
			const parsed = createSessionCommandSchema.parse(input);
			return options.dedupe.run(`createSession:${parsed.commandId}`, () => {
				if (!options.live.supports(parsed.harness)) {
					throw new Error(`unknown harness ${parsed.harness}`);
				}
				const sessionId = mintSessionId();
				const opened = options.journal.open({
					sessionId,
					scopeId: parsed.scopeId,
					harness: parsed.harness,
				});
				try {
					options.live.create({
						sessionId,
						scopeId: parsed.scopeId,
						harness: parsed.harness,
						cwd: parsed.cwd,
						modeId: parsed.modeId,
						modelId: parsed.modelId,
						execution: parsed.execution,
					});
				} catch (error) {
					options.journal.discard(sessionId);
					throw error;
				}
				return { sessionId, epoch: opened.epoch };
			});
		},

		prompt(input) {
			const parsed = promptCommandInputSchema.parse(input);
			return options.dedupe.run(`prompt:${parsed.commandId}`, () =>
				options.live
					.require(parsed.sessionId)
					.prompt(
						parsed.content,
						parsed.clientId,
						parsed.execution,
						parsed.resolvedAttachments,
					),
			);
		},

		cancelTurn(input) {
			const parsed: CancelTurnInput = cancelTurnInputSchema.parse(input);
			options.dedupe.run(`cancelTurn:${parsed.commandId}`, () => {
				options.live.require(parsed.sessionId).cancelTurn(parsed.turnId);
			});
		},

		respondToApproval(input) {
			const parsed: RespondToApprovalInput =
				respondToApprovalInputSchema.parse(input);
			options.dedupe.run(`respondToApproval:${parsed.commandId}`, () => {
				options.live
					.require(parsed.sessionId)
					.respondToApproval(parsed.approvalId, parsed.decision);
			});
		},

		setMode(input) {
			const parsed: SetModeInput = setModeInputSchema.parse(input);
			return options.dedupe.run(`setMode:${parsed.commandId}`, () =>
				options.live.require(parsed.sessionId).setMode(parsed.modeId),
			);
		},

		getSession(input) {
			const parsed: GetSessionInput = getSessionInputSchema.parse(input);
			const session = options.sessions.get(parsed.sessionId);
			return {
				session,
				...(session?.harness === "codex"
					? {
							state:
								options.live.get(parsed.sessionId)?.state ??
								readLatestSessionState(options.db, parsed.sessionId),
							isLive:
								options.live.get(parsed.sessionId)?.state.status !== "dead" &&
								options.live.get(parsed.sessionId) !== null,
						}
					: {}),
				cursor: session
					? {
							epoch: session.epoch,
							seq: options.journal.cursor(parsed.sessionId).seq,
						}
					: null,
			};
		},

		listSessions,

		getItems(input) {
			const parsed: GetItemsInput = getItemsInputSchema.parse(input);
			return readPage(options.db, parsed.sessionId, {
				before: parsed.before,
				limit: parsed.limit,
			});
		},
	};
}
