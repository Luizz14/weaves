import { Trans, useLingui } from "@lingui/react/macro";
import type { ApprovalRequest, Decision } from "@superset/chat/protocol";
import { errorMessage } from "@superset/i18n/errors";
import { useRef, useState } from "react";
import { ApprovalCard } from "renderer/components/agents/approval-card";
import { ToolApproval } from "renderer/components/agents/tool-approval";
import { ChatError } from "../ChatError/ChatError";
import { CodexToolContent } from "../CodexToolContent/CodexToolContent";

export function CodexApproval({
	item,
	onRespond,
}: {
	item: ApprovalRequest;
	onRespond: (id: string, decision: Decision) => Promise<void>;
}) {
	const { t } = useLingui();
	const [busy, setBusy] = useState(false);
	const submitting = useRef(false);
	const [error, setError] = useState<string | null>(null);
	async function respond(decision: Decision) {
		if (submitting.current || item.status !== "pending") return;
		submitting.current = true;
		setBusy(true);
		setError(null);
		try {
			await onRespond(item.id, decision);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			submitting.current = false;
			setBusy(false);
		}
	}
	if (item.status !== "pending")
		return (
			<div className="rounded-lg border p-3 text-xs text-muted-foreground">
				{item.title} ·{" "}
				{item.status === "stale" ? (
					<Trans>Expired</Trans>
				) : (
					<Trans>Answered</Trans>
				)}
			</div>
		);
	return (
		<div className="space-y-2">
			{item.options?.length ? (
				<ApprovalCard
					title={item.title}
					status={busy ? "submitting" : "pending"}
					questions={[
						{
							id: item.id,
							title: item.title,
							autoAdvance: false,
							allowCustom: false,
							options: item.options.map((option) => ({
								value: option.optionId,
								label: option.label,
							})),
						},
					]}
					submitLabel={t({ message: "Confirm" })}
					onSubmit={(answers) => {
						const optionId = answers[item.id]?.selected[0];
						if (optionId) void respond({ type: "option", optionId });
					}}
				/>
			) : (
				<ToolApproval
					tool="Codex"
					title={item.title}
					status={busy ? "approving" : "pending"}
					onApprove={() => void respond({ type: "accept" })}
					onDeny={() => void respond({ type: "decline" })}
					onAlwaysAllow={() => void respond({ type: "accept_for_session" })}
				/>
			)}
			{item.detail?.map((content, index) => (
				<CodexToolContent key={`${item.id}:${index}`} content={content} />
			))}
			{error && <ChatError message={error} />}
		</div>
	);
}
