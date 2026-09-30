import { Trans, useLingui } from "@lingui/react/macro";
import {
	LSP_INSTALL_INSTRUCTIONS,
	LSP_SERVER_LABELS,
} from "@superset/shared/lsp";
import { Button } from "@superset/ui/button";
import type { EditorLspStatus } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/coordinator";

export function LspStatus({
	status,
	retry,
}: {
	status: EditorLspStatus;
	retry: () => void;
}) {
	const { t } = useLingui();
	if (!status || status.state === "disabled") return null;
	const labels = {
		starting: t({ message: "Starting language server…" }),
		running: t({ message: "Language server ready" }),
		missing: t({ message: "Language server not found" }),
		failed: t({ message: "Language server unavailable" }),
		stopped: t({ message: "Language server stopped" }),
		disabled: t({ message: "Language server disabled" }),
	};
	return (
		<output
			className="flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground"
			title={status.error}
		>
			<span>{LSP_SERVER_LABELS[status.serverId]}</span>
			<span>{labels[status.state]}</span>
			{status.serverId === "kotlin" && (
				<span>
					<Trans>Experimental</Trans>
				</span>
			)}
			{status.state === "missing" && (
				<code className="min-w-0 truncate select-text">
					{LSP_INSTALL_INSTRUCTIONS[status.serverId]}
				</code>
			)}
			{(status.state === "failed" ||
				status.state === "missing" ||
				status.state === "stopped") && (
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto h-6 text-xs"
					onClick={retry}
				>
					<Trans>Retry</Trans>
				</Button>
			)}
		</output>
	);
}
