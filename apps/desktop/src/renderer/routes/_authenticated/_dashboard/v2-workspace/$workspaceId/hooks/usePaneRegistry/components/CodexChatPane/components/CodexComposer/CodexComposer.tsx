import { Trans, useLingui } from "@lingui/react/macro";
import type {
	CodexExecution,
	CodexGoal,
	CodexGoalAction,
	CodexModel,
} from "@superset/chat/protocol";
import { formatNumber } from "@superset/i18n/format";
import type { CodexModelPreset } from "@superset/shared/codex-chat-settings";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Settings2, Target, Zap } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { PromptInput } from "renderer/components/agents/prompt-input";
import { CodexModelSelector } from "renderer/components/CodexModelSelector";
import { isExecutionAvailable } from "renderer/components/CodexModelSelector/modelPresentation";
import { GoalStatus } from "../GoalStatus/GoalStatus";
import { PermissionsSelect } from "../PermissionsSelect/PermissionsSelect";

export function CodexComposer({
	disabled,
	running,
	mode,
	execution,
	presets,
	models,
	goal,
	onModeChange,
	onExecutionChange,
	onGoalChange,
	onSend,
	onStop,
}: {
	disabled?: boolean;
	running?: boolean;
	mode: string;
	execution: CodexExecution;
	presets: CodexModelPreset[];
	models: CodexModel[];
	goal?: CodexGoal | null;
	onModeChange: (mode: string) => void;
	onExecutionChange: (value: CodexExecution) => void;
	onGoalChange: (change: CodexGoalAction) => Promise<boolean>;
	onSend: (text: string, asGoal: boolean) => Promise<boolean> | boolean;
	onStop?: () => void;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;
	const [draft, setDraft] = useState("");
	const [armed, setArmed] = useState(false);
	const fast = models
		.find((model) => model.model === execution.modelId)
		?.serviceTiers.find((tier) => tier.id === "priority");
	const goalActive = goal?.status === "active";
	const toggleClass =
		"inline-flex min-h-12 min-w-10 shrink-0 items-center justify-center gap-1.5 px-2 rounded-full text-muted-foreground transition-[scale,background-color,color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] aria-pressed:bg-muted aria-pressed:text-foreground disabled:opacity-40 motion-reduce:active:scale-100";
	const layoutTransition = reduce
		? { duration: 0 }
		: { type: "spring" as const, duration: 0.3, bounce: 0.2 };
	return (
		<div className="mx-auto w-full max-w-3xl shrink-0 p-3">
			{goal && (
				<GoalStatus goal={goal} disabled={disabled} onChange={onGoalChange} />
			)}
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
				submitDisabled={
					!isExecutionAvailable(execution, models) ||
					(armed && draft.trim().length > 4000)
				}
				maxLength={armed ? 4000 : undefined}
				onStop={onStop}
				className="rounded-4xl shadow-[0_12px_64px_4px_color-mix(in_srgb,var(--border)_60%,transparent)] [&>div:last-child]:items-end p-3"
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
							aria-label="Fast"
							aria-pressed={execution.fast}
							onClick={() =>
								onExecutionChange({ ...execution, fast: !execution.fast })
							}
						>
							<Zap className="size-4" />
							{/*<span className="text-xs">{fast?.name ?? "Fast"}</span>*/}
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
							{/*<span className="text-xs">
								<Trans>Goal</Trans>
							</span>*/}
						</motion.button>
					</motion.div>
				}
				onSubmit={async (text) => {
					if (await onSend(text, armed)) {
						setDraft((current) => (current.trim() === text ? "" : current));
						setArmed(false);
					}
				}}
			/>
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
		</div>
	);
}
