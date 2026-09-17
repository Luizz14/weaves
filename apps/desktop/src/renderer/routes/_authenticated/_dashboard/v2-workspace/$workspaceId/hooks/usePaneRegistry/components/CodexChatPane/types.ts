import type { CodexExecution } from "@superset/chat/protocol";
export type InitialCodexPrompt = {
	sessionId: string;
	text: string;
	asGoal: boolean;
	execution: CodexExecution;
	commandId: string;
};
export type CodexChatMetadata = { title?: string; status: string };
