import { Trans } from "@lingui/react/macro";
import type { CodexExecution } from "@superset/chat/protocol";
import { errorMessage } from "@superset/i18n/errors";
import { Bot } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isExecutionAvailable } from "renderer/components/CodexModelSelector/modelPresentation";
import { useCodexChatSettings } from "renderer/hooks/useCodexChatSettings";
import { useCodexModels } from "renderer/hooks/useCodexModels";
import { useSessionClient } from "../../hooks/useSessionClient";
import { ChatError } from "./components/ChatError/ChatError";
import type {
	LinkedWorkspacePreview,
	PromptAttachment,
} from "./components/CodexComposer/CodexComposer";
import { CodexComposer } from "./components/CodexComposer/CodexComposer";
import { CodexSession } from "./components/CodexSession/CodexSession";
import { useLinkableWorkspaces } from "./hooks/useLinkableWorkspaces";
import type { CodexChatMetadata, InitialCodexPrompt } from "./types";

const DEFAULT_MODE = "auto";

export function CodexChatPane({
	workspaceId,
	sessionId,
	onSessionIdChange,
	onMetadata,
	isActive = true,
}: {
	workspaceId: string;
	sessionId: string | null;
	onSessionIdChange: (id: string | null) => void;
	onMetadata?: (value: CodexChatMetadata) => void;
	isActive?: boolean;
}) {
	const { client, wiring } = useSessionClient(sessionId);
	const settings = useCodexChatSettings();
	const catalog = useCodexModels(wiring.transport, wiring.streamBaseUrl);
	const linkable = useLinkableWorkspaces(workspaceId);
	const [execution, setExecution] = useState<CodexExecution | null>(null);
	const [preSessionLinkedWorkspaceIds, setPreSessionLinkedWorkspaceIds] =
		useState<string[]>([]);
	const [creating, setCreating] = useState(false);
	const inFlight = useRef(false);
	const commandId = useRef<string | null>(null);
	const creationAttempts = useRef(0);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<InitialCodexPrompt | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const clearFirstPrompt = useCallback(() => setPending(null), []);
	const preSessionLinkedWorkspaces = useMemo<LinkedWorkspacePreview[]>(
		() =>
			preSessionLinkedWorkspaceIds.flatMap((workspaceId) => {
				const workspace = linkable.workspaces.find(
					(entry) => entry.id === workspaceId,
				);
				return workspace
					? [
							{
								workspaceId: workspace.id,
								name: workspace.name,
								branch: workspace.branch ?? undefined,
							},
						]
					: [];
			}),
		[linkable.workspaces, preSessionLinkedWorkspaceIds],
	);
	useEffect(() => {
		if (!sessionId) setPreSessionLinkedWorkspaceIds([]);
	}, [sessionId]);
	useEffect(() => {
		if (settings.isPending || settings.error) return;
		const preset = settings.settings.presets.find(
			(entry) => entry.id === settings.settings.defaultPresetId,
		);
		if (preset)
			setExecution(
				(current) =>
					current ?? {
						modelId: preset.modelId,
						reasoningEffort: preset.reasoningEffort,
						fast: false,
						collaborationMode: "default",
					},
			);
	}, [settings.settings, settings.isPending, settings.error]);
	const canFocus = Boolean(execution);
	useEffect(() => {
		if (isActive && canFocus)
			root.current?.querySelector("textarea")?.focus({ preventScroll: true });
	}, [isActive, canFocus]);
	async function createSession(
		text: string,
		asGoal: boolean,
		attachments: PromptAttachment[],
	): Promise<boolean> {
		if (inFlight.current || !execution) return false;
		inFlight.current = true;
		setCreating(true);
		setError(null);
		commandId.current ??= crypto.randomUUID();
		creationAttempts.current += 1;
		const selectedLinkedWorkspaceIds = preSessionLinkedWorkspaceIds.filter((id) =>
			linkable.workspaces.some((workspace) => workspace.id === id),
		);
		try {
			const selected = asGoal
				? { ...execution, collaborationMode: "default" as const }
				: execution;
			const created = await wiring.transport.createSession({
				commandId: commandId.current,
				workspaceId,
				harness: "codex",
				modeId: DEFAULT_MODE,
				modelId: selected.modelId,
				execution: selected,
			});
			if (selectedLinkedWorkspaceIds.length > 0) {
				if (!wiring.transport.setLinkedWorkspaces)
					throw new Error("Update the host to link workspaces");
				await wiring.transport.setLinkedWorkspaces({
					commandId: crypto.randomUUID(),
					sessionId: created.sessionId,
					workspaceIds: selectedLinkedWorkspaceIds,
				});
			}
			if (creationAttempts.current > 1) {
				if (!wiring.transport.configureCodex)
					throw new Error("Update the host to configure Codex");
				await wiring.transport.configureCodex({
					commandId: crypto.randomUUID(),
					sessionId: created.sessionId,
					execution: selected,
				});
				await wiring.transport.setMode({
					commandId: crypto.randomUUID(),
					sessionId: created.sessionId,
					modeId: DEFAULT_MODE,
				});
			}
			commandId.current = null;
			creationAttempts.current = 0;
			setPending({
				sessionId: created.sessionId,
				text,
				asGoal,
				execution: selected,
				commandId: crypto.randomUUID(),
				...(attachments.length > 0 ? { attachments } : {}),
			});
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
	const unavailable =
		execution && catalog.data && !isExecutionAvailable(execution, catalog.data);
	return (
		<div
			ref={root}
			className="flex h-full min-h-0 w-full flex-col bg-background antialiased"
		>
			{(settings.error || catalog.error) && (
				<ChatError
					message={errorMessage(settings.error ?? catalog.error)}
					onRetry={() => {
						void catalog.refetch();
						void settings.refetch();
					}}
				/>
			)}
			{client && sessionId ? (
				<CodexSession
					key={sessionId}
					client={client}
					workspaceId={workspaceId}
					hostUrl={wiring.hostUrl ?? null}
					firstPrompt={pending?.sessionId === sessionId ? pending : null}
					onFirstPromptSent={clearFirstPrompt}
					onMetadata={onMetadata}
					isActive={isActive}
					presets={settings.settings.presets}
					models={catalog.data ?? []}
				/>
			) : (
				<>
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
						<Bot className="size-8 text-muted-foreground" />
						<h2 className="text-lg font-medium text-balance">
							<Trans>What would you like to build?</Trans>
						</h2>
						<p className="max-w-sm text-sm text-muted-foreground text-pretty">
							<Trans>
								Ask Codex to explore, change, or review this workspace.
							</Trans>
						</p>
					</div>
					{error && <ChatError message={error} />}

					{unavailable && (
						<p role="alert" className="px-4 text-sm text-destructive">
							<Trans>Unavailable on this host</Trans>
						</p>
					)}
					{execution && (
						<CodexComposer
							disabled={creating || settings.isPending || !catalog.data}
							hostUrl={wiring.hostUrl ?? null}
							execution={execution}
							presets={settings.settings.presets}
							models={catalog.data ?? []}
							onExecutionChange={setExecution}
							onGoalChange={async () => false}
							linkedWorkspaces={preSessionLinkedWorkspaces}
							linkableWorkspaces={linkable.workspaces}
							linkableLoading={linkable.isLoading}
							{...(wiring.transport.setLinkedWorkspaces
								? {
										onLinkedWorkspacesChange: async (workspaceIds: string[]) => {
											setPreSessionLinkedWorkspaceIds(workspaceIds);
											return true;
										},
								  }
								: {})}
							onSend={unavailable ? () => false : createSession}
						/>
					)}
				</>
			)}
		</div>
	);
}
