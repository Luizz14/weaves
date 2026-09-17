import { Trans, useLingui } from "@lingui/react/macro";
import type { CodexGoal, CodexGoalAction } from "@superset/chat/protocol";
import { Button } from "@superset/ui/button";
import { Textarea } from "@superset/ui/textarea";
import { useState } from "react";

export function GoalStatus({
	goal,
	disabled,
	onChange,
}: {
	goal: CodexGoal;
	disabled?: boolean;
	onChange: (change: CodexGoalAction) => Promise<boolean>;
}) {
	const { t } = useLingui();
	const [editing, setEditing] = useState(false);
	const [objective, setObjective] = useState(goal.objective);
	const labels = {
		active: t({ message: "Working" }),
		paused: t({ message: "Paused" }),
		blocked: t({ message: "Blocked" }),
		usageLimited: t({ message: "Usage limit reached" }),
		budgetLimited: t({ message: "Budget limit reached" }),
		complete: t({ message: "Completed" }),
	};
	return (
		<section
			aria-label={t({ message: "Goal" })}
			className="mb-2 rounded-xl bg-muted/40 p-3 text-xs"
		>
			<div className="flex items-start justify-between gap-2">
				<p className="min-w-0 break-words leading-5">{goal.objective}</p>
				<span className="shrink-0 text-muted-foreground">
					{labels[goal.status]}
				</span>
			</div>
			<div className="mt-1 flex flex-wrap gap-1">
				{goal.status !== "complete" && (
					<Button
						className="min-h-10"
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={() =>
							void onChange({
								action: goal.status === "active" ? "pause" : "resume",
							})
						}
					>
						{goal.status === "active" ? (
							<Trans>Pause</Trans>
						) : (
							<Trans>Resume</Trans>
						)}
					</Button>
				)}
				<Button
					className="min-h-10"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => {
						setObjective(goal.objective);
						setEditing(!editing);
					}}
				>
					<Trans>Edit</Trans>
				</Button>
				<Button
					className="min-h-10"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => void onChange({ action: "clear" })}
				>
					<Trans>End goal</Trans>
				</Button>
			</div>
			{editing && (
				<form
					className="mt-2 flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (objective.trim())
							void onChange({
								action: "set",
								objective: objective.trim(),
							}).then((success) => {
								if (success) setEditing(false);
							});
					}}
				>
					<Textarea
						className="min-h-20"
						aria-label={t({ message: "Goal" })}
						value={objective}
						onChange={(event) => setObjective(event.target.value)}
						maxLength={4000}
					/>
					<Button
						className="min-h-10"
						disabled={disabled || !objective.trim()}
						type="submit"
					>
						<Trans>Save</Trans>
					</Button>
				</form>
			)}
		</section>
	);
}
