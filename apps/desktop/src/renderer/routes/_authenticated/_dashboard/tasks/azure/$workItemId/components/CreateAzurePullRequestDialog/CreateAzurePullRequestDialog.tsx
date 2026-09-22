import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Checkbox } from "@superset/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useState } from "react";
import { LuGitPullRequest, LuLoaderCircle } from "react-icons/lu";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { usePullRequestDraft } from "../../hooks/usePullRequestDraft";

type CreateAzurePullRequestDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspace: {
		id: string;
		hostId: string;
		branch: string;
	};
	workItemId: number;
	workItemType: string;
	workItemTitle: string;
	workItemUrl: string;
	projectName: string;
	onCreated: () => void;
};

export function CreateAzurePullRequestDialog({
	open,
	onOpenChange,
	workspace,
	workItemId,
	workItemType,
	workItemTitle,
	workItemUrl,
	projectName,
	onCreated,
}: CreateAzurePullRequestDialogProps) {
	const { t } = useLingui();
	const hostUrl = useHostUrl(workspace.hostId);
	const { generate } = usePullRequestDraft({
		workItemId,
		workItemType,
		workItemTitle,
		workItemUrl,
		branch: workspace.branch,
		projectName,
	});
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [isDraft, setIsDraft] = useState(false);
	const [isCreating, setIsCreating] = useState(false);

	useEffect(() => {
		if (!open) return;
		void generate().then((value) => {
			setTitle(value.title);
			setBody(value.body);
		});
	}, [generate, open]);

	const handleCreate = async () => {
		if (!hostUrl || !title.trim()) return;
		setIsCreating(true);
		const toastId = toast.loading(t({ message: "Pushing branch…" }));
		try {
			const client = getHostServiceClientByUrl(hostUrl);
			await client.git.push.mutate({ workspaceId: workspace.id });
			toast.loading(t({ message: "Creating pull request…" }), { id: toastId });
			const created = await client.azureDevOps.createPullRequest.mutate({
				workspaceId: workspace.id,
				workItemId,
				title: title.trim(),
				body: body.trim() || undefined,
				draft: isDraft,
			});
			toast.success(t({ message: `PR #${created.number} created` }), {
				id: toastId,
				description: created.url,
			});
			onOpenChange(false);
			onCreated();
		} catch (error) {
			toast.error(
				errorMessage(error, t({ message: "Failed to create pull request" })),
				{
					id: toastId,
				},
			);
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle className="text-balance">
						<Trans>Create Azure DevOps pull request</Trans>
					</DialogTitle>
					<DialogDescription className="text-pretty">
						<Trans>
							Review the generated draft before pushing the branch and opening
							the pull request.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="grid gap-1.5">
						<Label htmlFor="azure-pr-title">
							<Trans>Title</Trans>
						</Label>
						<Input
							id="azure-pr-title"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							maxLength={400}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="azure-pr-body">
							<Trans>Description</Trans>
						</Label>
						<Textarea
							id="azure-pr-body"
							value={body}
							onChange={(event) => setBody(event.target.value)}
							className="min-h-52 font-mono text-sm"
							maxLength={4000}
						/>
					</div>
					<Label className="flex min-h-10 items-center gap-2 text-sm">
						<Checkbox
							checked={isDraft}
							onCheckedChange={(checked) => setIsDraft(checked === true)}
						/>
						<Trans>Create as draft</Trans>
					</Label>
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						className="h-10"
						onClick={() => onOpenChange(false)}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						className="h-10 transition-[transform,background-color] active:not-disabled:scale-[0.96]"
						disabled={!hostUrl || !title.trim() || isCreating}
						onClick={() => void handleCreate()}
					>
						{isCreating ? (
							<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
						) : (
							<LuGitPullRequest />
						)}
						<Trans>Create pull request</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
