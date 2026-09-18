import { Trans, useLingui } from "@lingui/react/macro";
import type {
	UserInputAnswers,
	UserInputRequest,
} from "@superset/chat/protocol";
import { errorMessage } from "@superset/i18n/errors";
import { useRef, useState } from "react";
import { ApprovalCard } from "renderer/components/agents/approval-card";
import { ChatError } from "../ChatError/ChatError";
export function CodexQuestion({
	item,
	onAnswer,
}: {
	item: UserInputRequest;
	onAnswer: (id: string, answers: UserInputAnswers) => Promise<void>;
}) {
	const { t } = useLingui();
	const [busy, setBusy] = useState(false);
	const sending = useRef(false);
	const [error, setError] = useState<string | null>(null);
	if (item.status !== "pending")
		return (
			<p className="text-xs text-muted-foreground">
				{item.status === "answered" ? (
					<Trans>Answered</Trans>
				) : (
					<Trans>Expired</Trans>
				)}
			</p>
		);
	return (
		<div>
			<ApprovalCard
				status={busy ? "submitting" : "pending"}
				submitLabel={t({ message: "Confirm" })}
				questions={item.questions.map((question) => ({
					id: question.id,
					title: question.question,
					description: question.header,
					options:
						question.options?.map((option) => ({
							value: option.label,
							label: option.label,
						})) ?? [],
					allowCustom: question.isOther || !question.options?.length,
					customInputType: question.isSecret ? "password" : "text",
					customPlaceholder: t({ message: "Message" }),
					autoAdvance: false,
				}))}
				onSubmit={async (values) => {
					if (sending.current) return;
					sending.current = true;
					setBusy(true);
					setError(null);
					try {
						await onAnswer(
							item.id,
							Object.fromEntries(
								item.questions.map((question) => {
									const answer = values[question.id];
									return [
										question.id,
										[
											...(answer?.selected ?? []),
											...(answer?.custom?.trim() ? [answer.custom.trim()] : []),
										],
									];
								}),
							),
						);
					} catch (cause) {
						setError(errorMessage(cause));
					} finally {
						sending.current = false;
						setBusy(false);
					}
				}}
			/>
			{error && <ChatError message={error} />}
		</div>
	);
}
