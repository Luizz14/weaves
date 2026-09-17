import type { LinkedWorkspace, UserContent } from "@superset/chat/protocol";
import {
	cancelTurnInputSchema,
	configureCodexInputSchema,
	createSessionInputSchema,
	getItemsInputSchema,
	getSessionInputSchema,
	listSessionsInputSchema,
	promptInputSchema,
	respondToApprovalInputSchema,
	respondToUserInputSchema,
	setLinkedWorkspacesInputSchema,
	setModeInputSchema,
	updateCodexGoalInputSchema,
} from "@superset/chat/protocol";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import type { ResolvedAttachment } from "../../harness";
import { listCodexModels } from "../../harness/codex/catalog";
import type { ChatRuntime } from "../../index";

import { createEnsureCodexSession } from "./ensureCodexSession";

const t = initTRPC.create();

export const createChatCallerFactory = t.createCallerFactory;

export type ResolvedWorkspace = {
	path: string;
	name: string;
	branch?: string;
};

export type ChatRouterOptions = {
	resolveCwd(workspaceId: string): string | Promise<string>;
	resolveWorkspace(
		workspaceId: string,
	): ResolvedWorkspace | Promise<ResolvedWorkspace>;
	resolveAttachment(
		attachmentId: string,
	):
		| { path: string; mimeType: string }
		| null
		| Promise<{ path: string; mimeType: string } | null>;
};

const UNKNOWN_HARNESS = /^unknown harness /;
const NOT_RUNNING = /^chat session (.+) is not running$/;

function mapCommandError(runtime: ChatRuntime, error: unknown): unknown {
	if (error instanceof TRPCError) return error;
	if (!(error instanceof Error)) return error;
	if (UNKNOWN_HARNESS.test(error.message)) {
		return new TRPCError({
			code: "BAD_REQUEST",
			message: error.message,
			cause: error,
		});
	}
	const sessionId = NOT_RUNNING.exec(error.message)?.[1];
	if (sessionId) {
		return new TRPCError({
			code: runtime.sessions.get(sessionId) ? "CONFLICT" : "NOT_FOUND",
			message: error.message,
			cause: error,
		});
	}
	return error;
}

export function createChatRouter(
	runtime: ChatRuntime,
	options: ChatRouterOptions,
) {
	const ensureCodexSession = createEnsureCodexSession(
		runtime,
		options.resolveCwd,
	);
	function guarded<T>(execute: () => T): T {
		try {
			return execute();
		} catch (error) {
			throw mapCommandError(runtime, error);
		}
	}

	async function resolveAttachments(
		content: UserContent[],
	): Promise<ResolvedAttachment[] | undefined> {
		const attachments = content.filter((entry) => entry.type === "attachment");
		if (attachments.length === 0) return undefined;
		return await Promise.all(
			attachments.map(async (entry) => {
				const resolved = await options.resolveAttachment(entry.attachmentId);
				if (!resolved)
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Attachment not found: ${entry.attachmentId}`,
					});
				return { attachmentId: entry.attachmentId, ...resolved };
			}),
		);
	}

	async function resolveWorkspaces(
		workspaceIds: string[],
	): Promise<LinkedWorkspace[]> {
		return await Promise.all(
			workspaceIds.map(async (workspaceId) => {
				try {
					const resolved = await options.resolveWorkspace(workspaceId);
					return { workspaceId, ...resolved };
				} catch (error) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Workspace not found: ${workspaceId}`,
						cause: error,
					});
				}
			}),
		);
	}

	return t.router({
		listCodexModels: t.procedure.query(() => listCodexModels()),
		configureCodex: t.procedure
			.input(configureCodexInputSchema)
			.mutation(async ({ input }) => {
				await ensureCodexSession(input.sessionId);
				return runtime.commands.configureCodex(input);
			}),
		updateCodexGoal: t.procedure
			.input(updateCodexGoalInputSchema)
			.mutation(async ({ input }) => {
				await ensureCodexSession(input.sessionId);
				return runtime.commands.updateCodexGoal(input);
			}),
		respondToUserInput: t.procedure
			.input(respondToUserInputSchema)
			.mutation(({ input }) => runtime.commands.respondToUserInput(input)),
		createSession: t.procedure
			.input(createSessionInputSchema)
			.mutation(async ({ input }) => {
				const { workspaceId, ...rest } = input;
				const cwd = await options.resolveCwd(workspaceId);
				return guarded(() =>
					runtime.commands.createSession({
						...rest,
						scopeId: workspaceId,
						cwd,
					}),
				);
			}),

		setLinkedWorkspaces: t.procedure
			.input(setLinkedWorkspacesInputSchema)
			.mutation(async ({ input }) => {
				await ensureCodexSession(input.sessionId);
				const workspaces = await resolveWorkspaces(input.workspaceIds);
				return runtime.commands.setLinkedWorkspaces({
					commandId: input.commandId,
					sessionId: input.sessionId,
					workspaces,
				});
			}),

		prompt: t.procedure.input(promptInputSchema).mutation(async ({ input }) => {
			await ensureCodexSession(input.sessionId);
			const resolvedAttachments = await resolveAttachments(input.content);
			return guarded(() =>
				runtime.commands.prompt({ ...input, resolvedAttachments }),
			);
		}),

		cancelTurn: t.procedure
			.input(cancelTurnInputSchema)
			.mutation(({ input }) =>
				guarded(() => runtime.commands.cancelTurn(input)),
			),

		respondToApproval: t.procedure
			.input(respondToApprovalInputSchema)
			.mutation(({ input }) =>
				guarded(() => runtime.commands.respondToApproval(input)),
			),

		setMode: t.procedure
			.input(setModeInputSchema)
			.mutation(async ({ input }) => {
				await ensureCodexSession(input.sessionId);
				return guarded(() => runtime.commands.setMode(input));
			}),

		getSession: t.procedure
			.input(getSessionInputSchema)
			.query(({ input }) => runtime.commands.getSession(input)),

		listSessions: t.procedure
			.input(listSessionsInputSchema)
			.query(({ input }) =>
				runtime.commands.listSessions({
					limit: input.limit,
					harness: input.harness,
					...(input.workspaceId === undefined
						? {}
						: { scopeId: input.workspaceId }),
				}),
			),

		getItems: t.procedure
			.input(getItemsInputSchema)
			.query(({ input }) => runtime.commands.getItems(input)),
	});
}

export type ChatRouter = ReturnType<typeof createChatRouter>;

export type ChatRouterInputs = inferRouterInputs<ChatRouter>;
export type ChatRouterOutputs = inferRouterOutputs<ChatRouter>;
