import { useCallback } from "react";

export type PullRequestDraftContext = {
	workItemId: number;
	workItemType: string;
	workItemTitle: string;
	workItemUrl: string;
	branch: string;
	projectName: string;
};

export type PullRequestDraft = {
	title: string;
	body: string;
};

export function usePullRequestDraft(context: PullRequestDraftContext) {
	const generate = useCallback(async (): Promise<PullRequestDraft> => {
		const prefix = context.workItemType.toLowerCase() === "bug" ? "BUG" : "US";
		return {
			title: `${prefix}-${context.workItemId}: ${context.workItemTitle}`,
			body: `## ${prefix}-${context.workItemId}\n\n[Azure DevOps work item](${context.workItemUrl})\n\n### Project\n\n${context.projectName}\n\n### Branch\n\n\`${context.branch}\``,
		};
	}, [context]);

	return { generate, aiAvailable: false };
}
