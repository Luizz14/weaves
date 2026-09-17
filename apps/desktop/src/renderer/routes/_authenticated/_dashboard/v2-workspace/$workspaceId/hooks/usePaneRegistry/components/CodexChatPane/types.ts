import type { CodexExecution } from "@superset/chat/protocol";
import type { PromptAttachment } from "./components/CodexComposer/CodexComposer";

export type InitialCodexPrompt = {
	sessionId: string;
	text: string;
	asGoal: boolean;
	execution: CodexExecution;
	commandId: string;
	attachments?: PromptAttachment[];
};
export type CodexChatMetadata = { title?: string; status: string };
