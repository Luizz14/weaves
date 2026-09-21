import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { workspaceTrpc } from "@superset/workspace-client";
import { useId, useState } from "react";
import { useIntegrationError } from "renderer/components/BranchIntegrationSettings/hooks/useIntegrationError";

export function ConflictEditor({
	workspaceId,
	sessionId,
	path,
	source,
	destination,
	onResolved,
}: {
	workspaceId: string;
	sessionId: string;
	path: string;
	source: string;
	destination: string;
	onResolved: () => void;
}) {
	const { t } = useLingui();
	const editorId = useId();
	const errorText = useIntegrationError();
	const input = { workspaceId, sessionId, path };
	const query = workspaceTrpc.branchIntegration.conflict.useQuery(input);
	const [draft, setDraft] = useState<string | null>(null);
	const resolve = workspaceTrpc.branchIntegration.resolve.useMutation({
		onSuccess: onResolved,
		onError: (error) => toast.error(errorText(error)),
	});
	if (query.isError)
		return (
			<div role="alert">
				{errorText(query.error)}
				<Button onClick={() => query.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	if (!query.data)
		return (
			<p>
				<Trans>Loading...</Trans>
			</p>
		);
	const { source: sourceFile, destination: destinationFile } = query.data;
	const editable = sourceFile?.editable && destinationFile?.editable;
	return (
		<div className="min-w-0 space-y-4">
			<h3 className="break-all font-mono text-sm">{path}</h3>
			<div className="grid grid-cols-2 gap-3">
				{[
					{
						label: destination,
						file: destinationFile,
						choice: "destination" as const,
					},
					{ label: source, file: sourceFile, choice: "source" as const },
				].map(({ label, file, choice }) => (
					<div key={choice} className="min-w-0 space-y-2">
						<h4 className="truncate text-sm font-medium" title={label}>
							{label}
						</h4>
						<pre className="h-48 overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
							{file?.content ??
								(file?.exists
									? t({
											message:
												"Binary, large, or special file. Choose a version to resolve.",
										})
									: t({ message: "File deleted" }))}
						</pre>
						<Button
							variant="outline"
							disabled={resolve.isPending}
							onClick={() => resolve.mutate({ ...input, choice })}
						>
							{t({ message: `Use ${label}` })}
						</Button>
					</div>
				))}
			</div>
			{editable && (
				<label htmlFor={editorId} className="grid gap-2 text-sm">
					<Trans>Resolved content</Trans>
					<Textarea
						id={editorId}
						className="min-h-48 font-mono text-xs"
						value={
							draft ?? destinationFile?.content ?? sourceFile?.content ?? ""
						}
						onChange={(event) => setDraft(event.target.value)}
						disabled={resolve.isPending}
					/>
				</label>
			)}
			<div className="flex flex-wrap gap-2">
				{editable && (
					<Button
						disabled={resolve.isPending}
						onClick={() =>
							resolve.mutate({
								...input,
								choice: "manual",
								content:
									draft ??
									destinationFile?.content ??
									sourceFile?.content ??
									"",
							})
						}
					>
						<Trans>Mark as resolved</Trans>
					</Button>
				)}
				<Button
					variant="outline"
					disabled={resolve.isPending}
					onClick={() => resolve.mutate({ ...input, choice: "delete" })}
				>
					<Trans>Delete file</Trans>
				</Button>
			</div>
		</div>
	);
}
