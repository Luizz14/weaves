import type {
	CodexExecution,
	CodexGoal,
	CodexGoalAction,
	Decision,
	Delta,
	Item,
	LinkedWorkspace,
	SessionState,
	Turn,
	UserContent,
	UserInputAnswers,
} from "@superset/chat/protocol";

export type AdapterEvent =
	| { kind: "item"; item: Item; turnId: string }
	| { kind: "delta"; delta: Delta }
	| { kind: "turn"; turn: Turn }
	| { kind: "session"; session: Partial<SessionState> };

export type HarnessStartOptions = {
	cwd: string;
	modeId?: string;
	modelId?: string;
	execution?: CodexExecution;
	goal?: CodexGoal | null;
	linkedWorkspaces?: LinkedWorkspace[];
	resume?: { harnessSessionId: string };
};

export type ResolvedAttachment = {
	attachmentId: string;
	path: string;
	mimeType: string;
};

export interface HarnessAdapter {
	start(options: HarnessStartOptions): AsyncIterable<AdapterEvent>;
	prompt(
		content: UserContent[],
		execution?: CodexExecution,
		resolvedAttachments?: ResolvedAttachment[],
	): void;
	configureCodex?(execution: CodexExecution): Promise<CodexExecution>;
	setLinkedWorkspaces?(
		workspaces: LinkedWorkspace[],
	): Promise<LinkedWorkspace[]>;
	updateGoal?(change: CodexGoalAction): Promise<void>;
	respondToUserInput?(requestId: string, answers: UserInputAnswers): void;
	cancelTurn(): void;
	respondToApproval(approvalId: string, decision: Decision): void;
	setMode(modeId: string): void | Promise<void>;
	dispose(): Promise<void>;
}
