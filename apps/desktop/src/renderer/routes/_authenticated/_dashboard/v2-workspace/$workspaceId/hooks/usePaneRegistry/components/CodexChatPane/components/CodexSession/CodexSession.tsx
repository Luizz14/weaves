import { Trans, useLingui } from "@lingui/react/macro";
import type { SessionClient } from "@superset/chat/client";
import { useChatSession, useTimeline } from "@superset/chat/react";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { useEffect, useRef, useState } from "react";
import {
	Message,
	MessageContent,
	MessageTyping,
} from "renderer/components/agents/message";
import { MessageScroller } from "renderer/components/agents/message-scroller";
import { ChatError } from "../ChatError/ChatError";
import { CodexComposer } from "../CodexComposer/CodexComposer";
import { CodexItem } from "../CodexItem/CodexItem";

export function CodexSession({
	client,
	firstPrompt,
	onFirstPromptSent,
}: {
	client: SessionClient;
	firstPrompt: string | null;
	onFirstPromptSent: () => void;
}) {
	const { t } = useLingui();
	const chat = useChatSession({ client });
	const groups = useTimeline(chat.snapshot);
	const sent = useRef(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [changingMode, setChangingMode] = useState(false);
	useEffect(() => {
		if (!firstPrompt || sent.current || chat.status !== "ready") return;
		sent.current = true;
		chat.sendPrompt([{ type: "text", text: firstPrompt }]);
		onFirstPromptSent();
	}, [firstPrompt, chat.status, chat.sendPrompt, onFirstPromptSent]);
	const state = chat.snapshot.session;
	const dormant = state?.status === "not_loaded";
	const turn = dormant
		? undefined
		: [...chat.snapshot.turns.values()].find(
				(candidate) => candidate.status === "running",
			);
	async function act(action: () => Promise<void>) {
		setActionError(null);
		try {
			await action();
		} catch (cause) {
			setActionError(errorMessage(cause));
		}
	}
	return (
		<>
			<output className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
				<span>{state?.modelId ?? "Codex"}</span>
				<span>
					{chat.connection !== "open" ? (
						<Trans>Offline</Trans>
					) : state?.status === "awaiting_input" ? (
						<Trans>Needs input</Trans>
					) : state?.status === "dead" ? (
						<Trans>Failed</Trans>
					) : turn ? (
						<Trans>Working</Trans>
					) : (
						<Trans>Ready</Trans>
					)}
				</span>
			</output>
			{chat.error ? (
				<ChatError message={errorMessage(chat.error)} onRetry={chat.reload} />
			) : null}
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
				{groups.map((group) => (
					<div key={group.turnId} className="space-y-4">
						{group.entries
							.flatMap((entry) =>
								entry.kind === "item" ? [entry.item] : entry.items,
							)
							.map((item) => (
								<CodexItem
									key={item.id}
									item={item}
									running={group.turn?.status === "running" && !dormant}
									onRespond={chat.respondToApproval}
								/>
							))}
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
								<div className="space-y-2">
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
								</div>
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
			{actionError && <ChatError message={actionError} />}
			<CodexComposer
				disabled={
					chat.status !== "ready" || Boolean(chat.error) || changingMode
				}
				running={Boolean(turn)}
				mode={state?.modeId ?? "auto"}
				onModeChange={(mode) => {
					setChangingMode(true);
					void act(() => chat.setMode(mode)).finally(() =>
						setChangingMode(false),
					);
				}}
				onSend={(text) => {
					chat.sendPrompt([{ type: "text", text }]);
					return true;
				}}
				onStop={
					turn ? () => void act(() => chat.cancelTurn(turn.id)) : undefined
				}
			/>
		</>
	);
}
