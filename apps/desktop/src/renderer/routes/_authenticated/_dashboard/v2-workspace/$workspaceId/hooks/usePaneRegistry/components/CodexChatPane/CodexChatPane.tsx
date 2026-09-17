import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Bot, PanelLeft, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ChatApp } from "renderer/components/agents/chat-app";
import { AnimatedSidebarTrigger } from "renderer/components/motion/animated-sidebar";
import { useSessionClient } from "../../hooks/useSessionClient";
import { ChatError } from "./components/ChatError/ChatError";
import { CodexComposer } from "./components/CodexComposer/CodexComposer";
import { CodexHistory } from "./components/CodexHistory/CodexHistory";
import { CodexSession } from "./components/CodexSession/CodexSession";

export function CodexChatPane({
	workspaceId,
	sessionId,
	onSessionIdChange,
}: {
	workspaceId: string;
	sessionId: string | null;
	onSessionIdChange: (id: string | null) => void;
}) {
	const { t } = useLingui();
	const { client, wiring } = useSessionClient(sessionId);
	const [mode, setMode] = useState("auto");
	const [creating, setCreating] = useState(false);
	const inFlight = useRef(false);
	const commandId = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<{
		sessionId: string;
		text: string;
	} | null>(null);
	const clearFirstPrompt = useCallback(() => setPending(null), []);
	function selectSession(id: string | null) {
		setError(null);
		setPending(null);
		commandId.current = null;
		onSessionIdChange(id);
	}
	async function createSession(text: string) {
		if (inFlight.current) return false;
		inFlight.current = true;
		setCreating(true);
		setError(null);
		commandId.current ??= crypto.randomUUID();
		try {
			const created = await wiring.transport.createSession({
				commandId: commandId.current,
				workspaceId,
				harness: "codex",
				modeId: mode,
			});
			commandId.current = null;
			setPending({ sessionId: created.sessionId, text });
			onSessionIdChange(created.sessionId);
			return true;
		} catch (cause) {
			setError(errorMessage(cause));
			return false;
		} finally {
			inFlight.current = false;
			setCreating(false);
		}
	}
	return (
		<ChatApp
			defaultOpen={false}
			keyboardShortcutEnabled={false}
			sidebarWidth="14rem"
			className="@container/codex relative h-full min-h-0 rounded-none border-0 bg-background"
		>
			<CodexHistory
				hostKey={wiring.streamBaseUrl}
				transport={wiring.transport}
				workspaceId={workspaceId}
				sessionId={sessionId}
				onSelect={(id) => {
					if (!creating) selectSession(id);
				}}
				onNew={() => {
					if (!creating) selectSession(null);
				}}
			/>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
					<AnimatedSidebarTrigger aria-label={t({ message: "History" })}>
						<PanelLeft className="size-4" />
					</AnimatedSidebarTrigger>
					<Bot className="size-4 text-muted-foreground" />
					<span className="text-sm font-medium">
						<Trans>Codex Chat</Trans>
					</span>
					<Button
						className="ml-auto"
						variant="ghost"
						size="icon"
						disabled={creating}
						onClick={() => selectSession(null)}
						aria-label={t({ message: "New chat" })}
					>
						<Plus className="size-4" />
					</Button>
				</header>
				{client && sessionId ? (
					<CodexSession
						key={sessionId}
						client={client}
						firstPrompt={pending?.sessionId === sessionId ? pending.text : null}
						onFirstPromptSent={clearFirstPrompt}
					/>
				) : (
					<>
						<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
							<div className="flex size-12 items-center justify-center rounded-2xl border bg-muted/30">
								<Bot className="size-6 text-muted-foreground" />
							</div>
							<h2 className="text-lg font-medium">
								<Trans>What would you like to build?</Trans>
							</h2>
							<p className="max-w-sm text-sm text-muted-foreground">
								<Trans>
									Ask Codex to explore, change, or review this workspace.
								</Trans>
							</p>
						</div>
						{error && <ChatError message={error} />}
						<CodexComposer
							disabled={creating}
							mode={mode}
							onModeChange={setMode}
							onSend={createSession}
						/>
					</>
				)}
			</main>
		</ChatApp>
	);
}
