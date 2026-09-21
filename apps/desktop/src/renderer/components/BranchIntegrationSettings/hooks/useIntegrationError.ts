import { useLingui } from "@lingui/react/macro";

export function useIntegrationError() {
	const { t } = useLingui();
	return (error: { message: string }) => {
		const messages: Record<string, string> = {
			DIRTY: t({
				message:
					"Commit or stash pending changes in the source and destination workspaces first.",
			}),
			GIT_OPERATION_PENDING: t({
				message: "Finish the pending Git operation first.",
			}),
			CONFIGURE: t({
				message:
					"Configure the principal branch and remote in project settings.",
			}),
			DISABLED: t({ message: "This operation is disabled for this project." }),
			SAME_BRANCH: t({
				message: "The current branch is already the principal branch.",
			}),
			DETACHED: t({ message: "Check out a branch before continuing." }),
			BRANCH_MISSING: t({
				message: "The principal branch does not exist locally.",
			}),
			REMOTE_MISSING: t({ message: "The configured remote no longer exists." }),
			FETCH_FAILED: t({
				message:
					"Could not fetch the principal branch. Check your connection, credentials, and remote branch.",
			}),
			BRANCH_CHANGED: t({
				message:
					"A branch changed during integration. Cancel this attempt and start again.",
			}),
			CONFIG_CHANGED: t({
				message:
					"Project settings changed. Cancel this attempt and start again.",
			}),
			RESTART_REQUIRED: t({
				message:
					"Preparation was interrupted. Cancel this attempt and start again.",
			}),
			UNRESOLVED: t({
				message: "Resolve all conflicts before completing the integration.",
			}),
			SESSION_EXISTS: t({
				message: "Resume or cancel the existing integration first.",
			}),
			BUSY: t({
				message: "Another integration operation is running. Try again shortly.",
			}),
			MULTIPLE_CHECKOUTS: t({
				message: "The destination branch is checked out in multiple worktrees.",
			}),
		};
		return (
			messages[error.message] ??
			t({
				message:
					"Git integration failed. Check the repository and retry, or cancel the attempt.",
			})
		);
	};
}
