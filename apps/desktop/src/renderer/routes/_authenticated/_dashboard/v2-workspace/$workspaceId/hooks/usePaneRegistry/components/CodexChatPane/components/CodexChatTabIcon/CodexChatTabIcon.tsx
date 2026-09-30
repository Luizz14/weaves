import { MessageSquare } from "lucide-react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";

export function CodexChatTabIcon() {
	const src = usePresetIcon("codex");
	return src ? (
		<img
			src={src}
			alt="Codex"
			className="size-3.5 shrink-0"
			draggable={false}
		/>
	) : (
		<MessageSquare className="size-3.5" />
	);
}
