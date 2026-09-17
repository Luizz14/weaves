import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";

export function ChatError({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div
			role="alert"
			className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
		>
			<p className="break-words">{message}</p>
			<p className="mt-2 text-xs text-muted-foreground">
				<Trans>
					Check the workspace host connection and Codex installation. If sign-in
					is required, run <code>codex login</code> in that host's terminal,
					then retry.
				</Trans>
			</p>
			{onRetry && (
				<Button className="mt-2" size="sm" variant="outline" onClick={onRetry}>
					<Trans>Retry</Trans>
				</Button>
			)}
		</div>
	);
}
