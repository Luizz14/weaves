import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { PromptInput } from "renderer/components/agents/prompt-input";
import { PermissionsSelect } from "../PermissionsSelect/PermissionsSelect";

export function CodexComposer({
	disabled,
	running,
	mode,
	onModeChange,
	onSend,
	onStop,
}: {
	disabled?: boolean;
	running?: boolean;
	mode: string;
	onModeChange: (mode: string) => void;
	onSend: (text: string) => Promise<boolean> | boolean;
	onStop?: () => void;
}) {
	const { t } = useLingui();
	const [draft, setDraft] = useState("");
	return (
		<div className="mx-auto w-full max-w-3xl shrink-0 p-3">
			<PromptInput
				value={draft}
				onValueChange={setDraft}
				disabled={disabled}
				placeholder={t({ message: "Ask Codex to work on this workspace…" })}
				aria-label={t({ message: "Message" })}
				loading={running}
				onStop={onStop}
				className="rounded-xl shadow-none"
				leadingAction={
					<PermissionsSelect
						value={mode}
						disabled={disabled}
						onChange={onModeChange}
					/>
				}
				onSubmit={async (text) => {
					if (await onSend(text))
						setDraft((current) => (current.trim() === text ? "" : current));
				}}
			/>
		</div>
	);
}
