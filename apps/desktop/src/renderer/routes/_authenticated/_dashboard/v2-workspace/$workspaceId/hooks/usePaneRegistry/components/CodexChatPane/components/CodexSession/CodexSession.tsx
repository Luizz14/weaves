import { Trans, useLingui } from "@lingui/react/macro";
import type { SessionClient } from "@superset/chat/client";
import type {
	CodexExecution,
	CodexGoalAction,
	CodexModel,
} from "@superset/chat/protocol";
import { useChatSession, useTimeline } from "@superset/chat/react";
import { errorMessage } from "@superset/i18n/errors";
import type { CodexModelPreset } from "@superset/shared/codex-chat-settings";
import { Button } from "@superset/ui/button";
import { useEffect, useRef, useState } from "react";
import {
	Message,
	MessageContent,
	MessageTyping,
} from "renderer/components/agents/message";
import { MessageScroller } from "renderer/components/agents/message-scroller";
import { isExecutionAvailable } from "renderer/components/CodexModelSelector/modelPresentation";
import type { CodexChatMetadata, InitialCodexPrompt } from "../../types";
import { ChatError } from "../ChatError/ChatError";
import { CodexComposer } from "../CodexComposer/CodexComposer";
import { CodexTurn } from "../CodexTurn/CodexTurn";

export function CodexSession({
	client,
	firstPrompt,
	onFirstPromptSent,
	onMetadata,
	presets,
	models,
	isActive = true,
}: {
	client: SessionClient;
	firstPrompt: InitialCodexPrompt | null;
	onFirstPromptSent: () => void;
	onMetadata?: (metadata: CodexChatMetadata) => void;
	presets: CodexModelPreset[];
	models: CodexModel[];
	isActive?: boolean;
}) {
	const { t } = useLingui();
	const root = useRef<HTMLDivElement>(null);
	const chat = useChatSession({ client });
	const groups = useTimeline(chat.snapshot);
	const sent = useRef(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [selection, setSelection] = useState<CodexExecution | null>(null);
	const state = chat.snapshot.session;
	const dormant = state?.status === "not_loaded";
	const turn = dormant
		? undefined
		: [...chat.snapshot.turns.values()].find(
				(candidate) => candidate.status === "running",
			);
	const fallbackModel = state?.modelId ?? firstPrompt?.execution.modelId ?? "";
	const execution = selection ??
		state?.execution ??
		firstPrompt?.execution ?? {
			modelId: fallbackModel,
			reasoningEffort: state?.reasoningEffort ?? "default",
			fast: state?.serviceTier === "priority",
			collaborationMode: "default",
		};
	useEffect(() => {
		if (state?.execution) setSelection(state.execution);
	}, [state?.execution]);
	const title = state?.title;
	const status =
		state?.status === "idle" && state.goal?.status === "active"
			? "running"
			: state?.goal &&
					["blocked", "usageLimited", "budgetLimited"].includes(
						state.goal.status,
					)
				? "awaiting_input"
				: state?.status;
	useEffect(() => {
		if (status) onMetadata?.({ title, status });
	}, [title, status, onMetadata]);
	useEffect(() => {
		if (isActive && chat.status === "ready")
			root.current?.querySelector("textarea")?.focus({ preventScroll: true });
	}, [isActive, chat.status]);
	async function act(action: () => Promise<void>): Promise<boolean> {
		setActionError(null);
		setBusy(true);
		try {
			await action();
			return true;
		} catch (cause) {
			setActionError(errorMessage(cause));
			return false;
		} finally {
			setBusy(false);
		}
	}
	useEffect(() => {
		if (!firstPrompt || sent.current || chat.status !== "ready") return;
		sent.current = true;
		if (firstPrompt.asGoal) {
			setBusy(true);
			void (async () => {
				if (!client.updateGoal) throw new Error("Goals unavailable");
				await client.updateGoal(
					{ action: "set", objective: firstPrompt.text },
					firstPrompt.commandId,
				);
				onFirstPromptSent();
			})()
				.catch((cause) => {
					setActionError(errorMessage(cause));
					sent.current = false;
				})
				.finally(() => setBusy(false));
		} else {
			chat.sendPrompt(
				[{ type: "text", text: firstPrompt.text }],
				firstPrompt.execution,
			);
			onFirstPromptSent();
		}
	}, [firstPrompt, chat.status, chat.sendPrompt, onFirstPromptSent, client]);
	async function updateGoal(change: CodexGoalAction) {
		return act(async () => {
			if (!client.updateGoal) throw new Error("Goals unavailable");
			await client.updateGoal(change);
		});
	}
	async function implementPlan(plan: string) {
		return act(async () => {
			if (!client.updateGoal) throw new Error("Goals unavailable");
			await client.configureCodex?.({
				...execution,
				collaborationMode: "default",
			});
			await client.updateGoal({ action: "set", objective: plan });
		});
	}
	const goalInFlight = Boolean(state?.goal && state.goal.status !== "complete");
	const canImplementPlan =
		!dormant && !turn && !goalInFlight && Boolean(client.updateGoal);
	return (
		<div ref={root} className="contents">
			{chat.error && (
				<ChatError message={errorMessage(chat.error)} onRetry={chat.reload} />
			)}
			<MessageScroller
				className="min-h-0 flex-1"
				contentClassName="mx-auto w-full max-w-3xl space-y-5 px-4 py-6"
				label={t({ message: "Messages" })}
				busy={Boolean(turn)}
			>
				{chat.hasOlder && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void act(chat.loadOlder)}
					>
						<Trans>Load older messages</Trans>
					</Button>
				)}
				{groups.map((group, index) => (
					<div key={group.turnId}>
						<CodexTurn
							group={group}
							dormant={dormant}
							{...(canImplementPlan && index === groups.length - 1
								? { onImplementPlan: implementPlan }
								: {})}
							onRespond={chat.respondToApproval}
							onAnswer={async (id, answers) => {
								if (!client.respondToUserInput)
									throw new Error("Questions unavailable");
								await client.respondToUserInput(id, answers);
							}}
						/>
						{group.turn?.error && (
							<ChatError message={group.turn.error.message} />
						)}
					</div>
				))}
				{chat.outbox.map((entry) => (
					<Message key={entry.clientId} from="user" animateIn={false}>
						<MessageContent>
							<p className="whitespace-pre-wrap break-words">
								{entry.content
									.map((part) => (part.type === "text" ? part.text : part.name))
									.join("\n")}
							</p>
							{entry.state === "failed" ? (
								<>
									<ChatError
										message={
											entry.lastError ?? t({ message: "Something went wrong" })
										}
										onRetry={() => chat.retryPrompt(entry.clientId)}
									/>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => chat.discardPrompt(entry.clientId)}
									>
										<Trans>Discard</Trans>
									</Button>
								</>
							) : (
								<span className="text-xs text-muted-foreground">
									<Trans>Sending…</Trans>
								</span>
							)}
						</MessageContent>
					</Message>
				))}
				{turn && <MessageTyping label={t({ message: "Working" })} />}
			</MessageScroller>
			{actionError && (
				<ChatError
					message={actionError}
					onRetry={
						firstPrompt?.asGoal
							? () => {
									sent.current = false;
									setActionError(null);
									chat.reload();
								}
							: undefined
					}
				/>
			)}
			{models.length > 0 && !isExecutionAvailable(execution, models) && (
				<p role="alert" className="px-4 text-sm text-destructive">
					<Trans>Unavailable on this host</Trans>
				</p>
			)}
			<CodexComposer
				disabled={
					chat.status !== "ready" ||
					Boolean(chat.error) ||
					busy ||
					!models.length
				}
				running={Boolean(turn)}
				mode={state?.modeId ?? "auto"}
				execution={execution}
				presets={presets}
				models={models}
				goal={
					dormant && state?.goal?.status === "active"
						? { ...state.goal, status: "paused" }
						: state?.goal
				}
				onModeChange={(mode) => void act(() => chat.setMode(mode))}
				onExecutionChange={(next) =>
					void act(async () => {
						if (!client.configureCodex)
							throw new Error("Configuration unavailable");
						const applied = await client.configureCodex(next);
						setSelection(applied);
					})
				}
				onGoalChange={updateGoal}
				onSend={async (text, asGoal) => {
					if (!isExecutionAvailable(execution, models)) {
						setActionError(t({ message: "Unavailable on this host" }));
						return false;
					}
					if (asGoal)
						return act(async () => {
							if (!client.updateGoal) throw new Error("Goals unavailable");
							await client.configureCodex?.({
								...execution,
								collaborationMode: "default",
							});
							await client.updateGoal({ action: "set", objective: text });
						});
					chat.sendPrompt(
						[{ type: "text", text }],
						selection || state?.execution ? execution : undefined,
					);
					return true;
				}}
				onStop={
					turn
						? () =>
								void act(async () => {
									if (state?.goal && state.goal.status !== "complete")
										await client.updateGoal?.({ action: "pause" });
									else await chat.cancelTurn(turn.id);
								})
						: undefined
				}
			/>
		</div>
	);
}
