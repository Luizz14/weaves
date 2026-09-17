import { Trans, useLingui } from "@lingui/react/macro";
import type {
	CodexExecution,
	CodexGoal,
	CodexGoalAction,
	CodexModel,
	LinkedWorkspace,
} from "@superset/chat/protocol";
import { formatNumber } from "@superset/i18n/format";
import type { CodexModelPreset } from "@superset/shared/codex-chat-settings";

import {
	ClipboardList,
	FolderInput,
	Paperclip,
	Target,
	Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type DragEvent, type KeyboardEvent, useRef, useState } from "react";
import { PromptInput } from "renderer/components/agents/prompt-input";
import { CodexModelSelector } from "renderer/components/CodexModelSelector";
import { isExecutionAvailable } from "renderer/components/CodexModelSelector/modelPresentation";
import { cn } from "renderer/lib/utils";
import { useChatAttachments } from "../../hooks/useChatAttachments";
import { AttachmentTray } from "../AttachmentTray";
import { GoalStatus } from "../GoalStatus/GoalStatus";
import { LinkedWorkspacesBar } from "../LinkedWorkspacesBar";
import type { LinkableWorkspace } from "../LinkWorkspacesDialog";
import { LinkWorkspacesDialog } from "../LinkWorkspacesDialog";

export type PromptAttachment = {
	attachmentId: string;
	name: string;
	mimeType: string;
};

const ATTACH_ACTION = "attach";
const LINK_ACTION = "link";

export function CodexComposer({
	disabled,
	running,
	hostUrl,
	execution,
	presets,
	models,
	goal,
	linkedWorkspaces = [],
	linkableWorkspaces = [],
	linkableLoading,
	onExecutionChange,
	onGoalChange,
	onLinkedWorkspacesChange,
	onSend,
	onStop,
}: {
	disabled?: boolean;
	running?: boolean;
	hostUrl: string | null;
	execution: CodexExecution;
	presets: CodexModelPreset[];
	models: CodexModel[];
	goal?: CodexGoal | null;
	linkedWorkspaces?: LinkedWorkspace[];
	linkableWorkspaces?: LinkableWorkspace[];
	linkableLoading?: boolean;
	onExecutionChange: (value: CodexExecution) => void;
	onGoalChange: (change: CodexGoalAction) => Promise<boolean>;
	onLinkedWorkspacesChange?: (workspaceIds: string[]) => Promise<boolean>;
	onSend: (
		text: string,
		asGoal: boolean,
		attachments: PromptAttachment[],
	) => Promise<boolean> | boolean;
	onStop?: () => void;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;
	const [draft, setDraft] = useState("");
	const [armed, setArmed] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const [dropActive, setDropActive] = useState(false);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const attachments = useChatAttachments(hostUrl);
	const fast = models
		.find((model) => model.model === execution.modelId)
		?.serviceTiers.find((tier) => tier.id === "priority");
	const goalActive = goal?.status === "active";
	const linkedIds = linkedWorkspaces.map((entry) => entry.workspaceId);
	// A goal is a single string objective, so there is nowhere to put a file.
	const canAttach = !armed;
	const toggleClass =
		"inline-flex min-h-12 min-w-10 shrink-0 items-center justify-center gap-1.5 px-2 rounded-full text-muted-foreground transition-[scale,background-color,color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] aria-pressed:bg-muted aria-pressed:text-foreground disabled:opacity-40 motion-reduce:active:scale-100";
	const layoutTransition = reduce
		? { duration: 0 }
		: { type: "spring" as const, duration: 0.3, bounce: 0.2 };

	function pickFiles() {
		setAttachmentError(null);
		fileInput.current?.click();
	}

	function addFiles(files: File[]) {
		if (files.length === 0) return;
		setAttachmentError(null);
		attachments.add(files);
	}

	function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		const key = event.key.toLowerCase();
		if (key === "u" && canAttach) {
			event.preventDefault();
			pickFiles();
			return;
		}
		if (key === "i" && onLinkedWorkspacesChange) {
			event.preventDefault();
			setLinkOpen(true);
		}
	}

	function onDrop(event: DragEvent<HTMLDivElement>) {
		setDropActive(false);
		if (!canAttach) return;
		const files = [...event.dataTransfer.files];
		if (files.length === 0) return;
		event.preventDefault();
		addFiles(files);
	}

	async function toggleLinked(nextId: string) {
		if (!onLinkedWorkspacesChange) return;
		const next = linkedIds.includes(nextId)
			? linkedIds.filter((id) => id !== nextId)
			: [...linkedIds, nextId];
		await onLinkedWorkspacesChange(next);
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a drop target has no role of its own, and dropping is never the only way in — ⌘U and the + menu are.
		<div
			className="mx-auto w-full max-w-3xl shrink-0 p-3"
			onDragEnter={() => canAttach && setDropActive(true)}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					setDropActive(false);
			}}
			onDragOver={(event) => {
				if (canAttach) event.preventDefault();
			}}
			onDrop={onDrop}
		>
			{goal && (
				<GoalStatus goal={goal} disabled={disabled} onChange={onGoalChange} />
			)}
			{onLinkedWorkspacesChange && (
				<LinkedWorkspacesBar
					disabled={disabled}
					onRemove={(id) => void toggleLinked(id)}
					workspaces={linkedWorkspaces.map((entry) => ({
						id: entry.workspaceId,
						name: entry.name,
						branch: entry.branch,
					}))}
				/>
			)}
			<AttachmentTray
				attachments={attachments.attachments}
				disabled={disabled}
				onRemove={attachments.remove}
				onRetry={attachments.retry}
			/>
			<input
				accept="image/*,text/*,application/pdf,application/json,.md,.csv,.log"
				className="hidden"
				multiple
				onChange={(event) => {
					addFiles([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
				ref={fileInput}
				tabIndex={-1}
				type="file"
			/>
			<PromptInput
				value={draft}
				onValueChange={setDraft}
				disabled={disabled}
				placeholder={
					armed
						? t({ message: "Describe the goal and how to verify it…" })
						: t({ message: "Ask Codex to work on this workspace…" })
				}
				aria-label={t({ message: "Message" })}
				loading={running}
				allowEmptySubmit={attachments.attachments.length > 0}
				submitDisabled={
					!isExecutionAvailable(execution, models) ||
					(armed && draft.trim().length > 4000)
				}
				maxLength={armed ? 4000 : undefined}
				onKeyDown={onComposerKeyDown}
				onPaste={(event) => {
					if (!canAttach) return;
					const files = [...event.clipboardData.files];
					if (files.length === 0) return;
					event.preventDefault();
					addFiles(files);
				}}
				onStop={onStop}
				actions={[
					{
						value: ATTACH_ACTION,
						label: t({ message: "Add attachment" }),
						icon: <Paperclip />,
						shortcut: "⌘U",
						disabled: !canAttach,
					},
					...(onLinkedWorkspacesChange
						? [
								{
									value: LINK_ACTION,
									label: t({ message: "Link workspaces" }),
									icon: <FolderInput />,
									shortcut: "⌘I",
								},
							]
						: []),
				]}
				onAction={(action) => {
					if (action === ATTACH_ACTION) pickFiles();
					if (action === LINK_ACTION) setLinkOpen(true);
				}}
				className={cn(
					"rounded-4xl shadow-[0_12px_64px_4px_color-mix(in_srgb,var(--border)_60%,transparent)] [&>div:last-child]:items-end p-3",
					dropActive && "outline-ring/70",
				)}
				leadingAction={
					<motion.div
						layout={!reduce}
						transition={layoutTransition}
						className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
					>
						<motion.div
							layout={reduce ? false : "position"}
							transition={layoutTransition}
						>
							<CodexModelSelector
								value={execution}
								presets={presets}
								models={models}
								disabled={disabled}
								onChange={(preset) =>
									onExecutionChange({
										...execution,
										modelId: preset.modelId,
										reasoningEffort: preset.reasoningEffort,
									})
								}
							/>
						</motion.div>
						<motion.button
							layout={reduce ? false : "position"}
							transition={layoutTransition}
							type="button"
							className={toggleClass}
							disabled={disabled || (!fast && !execution.fast)}
							title={t({ message: "Fast uses more of your allowance." })}
							aria-label={t({ message: "Fast" })}
							aria-pressed={execution.fast}
							onClick={() =>
								onExecutionChange({ ...execution, fast: !execution.fast })
							}
						>
							<Zap className="size-4" />
						</motion.button>
						<motion.button
							layout={reduce ? false : "position"}
							transition={layoutTransition}
							type="button"
							className={toggleClass}
							disabled={disabled}
							title={t({ message: "Planning" })}
							aria-label={t({ message: "Planning" })}
							aria-pressed={execution.collaborationMode === "plan"}
							onClick={() => {
								setArmed(false);
								onExecutionChange({
									...execution,
									collaborationMode:
										execution.collaborationMode === "plan" ? "default" : "plan",
								});
							}}
						>
							<ClipboardList className="size-4" />
						</motion.button>
						<motion.button
							layout={reduce ? false : "position"}
							transition={layoutTransition}
							type="button"
							className={toggleClass}
							disabled={disabled}
							title={t({ message: "Goal" })}
							aria-label={t({ message: "Goal" })}
							aria-pressed={armed || goalActive}
							onClick={() => {
								if (goalActive) void onGoalChange({ action: "pause" });
								else if (goal && goal.status !== "complete")
									void onGoalChange({ action: "resume" });
								else {
									setArmed(!armed);
									if (!armed && execution.collaborationMode === "plan")
										onExecutionChange({
											...execution,
											collaborationMode: "default",
										});
								}
							}}
						>
							<Target className="size-4" />
						</motion.button>
					</motion.div>
				}
				onSubmit={async (text) => {
					const settled = await attachments.awaitReady();
					if (settled.errors.length > 0) {
						setAttachmentError(settled.errors[0]?.message ?? null);
						return;
					}
					if (!text.trim() && settled.ready.length === 0) return;
					if (await onSend(text, armed, settled.ready)) {
						setDraft((current) => (current.trim() === text ? "" : current));
						setArmed(false);
						attachments.clear();
					}
				}}
			/>
			{attachmentError && (
				<p className="px-2 pt-2 text-xs text-destructive" role="alert">
					{attachmentError}
				</p>
			)}
			{armed && (
				<p className="px-2 pt-2 text-xs text-muted-foreground">
					<span className="float-right ml-2 tabular-nums">
						{formatNumber(draft.trim().length)} / {formatNumber(4000)}
					</span>
					<Trans>
						The next message becomes the goal. Codex will continue until it
						finishes or needs your input.
					</Trans>
				</p>
			)}
			{onLinkedWorkspacesChange && (
				<LinkWorkspacesDialog
					isLoading={linkableLoading}
					linkedIds={linkedIds}
					onOpenChange={setLinkOpen}
					onToggle={(id) => void toggleLinked(id)}
					open={linkOpen}
					workspaces={linkableWorkspaces}
				/>
			)}
		</div>
	);
}
