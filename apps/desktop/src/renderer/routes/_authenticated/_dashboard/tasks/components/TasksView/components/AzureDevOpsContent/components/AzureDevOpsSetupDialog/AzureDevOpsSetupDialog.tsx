import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
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
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

type AzureDevOpsSetupDialogProps = {
	hostUrl: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfigured: () => void;
};

export function AzureDevOpsSetupDialog({
	hostUrl,
	open,
	onOpenChange,
	onConfigured,
}: AzureDevOpsSetupDialogProps) {
	const { t } = useLingui();
	const [organizationUrl, setOrganizationUrl] = useState("");
	const [workItemProject, setWorkItemProject] = useState("");
	const [team, setTeam] = useState("");
	const [areaPath, setAreaPath] = useState("");
	const [assignedTo, setAssignedTo] = useState("");
	const save = useMutation({
		mutationFn: async () => {
			if (!hostUrl) throw new Error("Host service is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.setBoardConfig.mutate({
				organizationUrl: organizationUrl.trim(),
				workItemProject: workItemProject.trim(),
				team: team.trim(),
				areaPath: areaPath.trim(),
				assignedTo: assignedTo.trim() || null,
				workItemTypes: ["Bug", "User Story"],
			});
		},
		onSuccess: () => {
			toast.success(t({ message: "Azure DevOps board connected" }));
			onOpenChange(false);
			onConfigured();
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to connect Azure DevOps" })),
			),
	});
	const isComplete =
		organizationUrl.trim().length > 0 &&
		workItemProject.trim().length > 0 &&
		team.trim().length > 0 &&
		areaPath.trim().length > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-balance">
						<Trans>Connect Azure DevOps board</Trans>
					</DialogTitle>
					<DialogDescription className="text-pretty">
						<Trans>
							Work items stay in Azure DevOps. Superset only stores the extra
							workflow stages and workspace links on this host.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="grid gap-1.5">
						<Label htmlFor="azure-board-organization">
							<Trans>Organization URL</Trans>
						</Label>
						<Input
							id="azure-board-organization"
							value={organizationUrl}
							onChange={(event) => setOrganizationUrl(event.target.value)}
							placeholder="https://dev.azure.com/organization"
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
					</div>
					<div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="azure-board-project">
								<Trans>Work item project</Trans>
							</Label>
							<Input
								id="azure-board-project"
								value={workItemProject}
								onChange={(event) => setWorkItemProject(event.target.value)}
								placeholder={t({ message: "Project name" })}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="azure-board-team">
								<Trans>Team</Trans>
							</Label>
							<Input
								id="azure-board-team"
								value={team}
								onChange={(event) => setTeam(event.target.value)}
								placeholder={t({ message: "Team name" })}
							/>
						</div>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="azure-board-area">
							<Trans>Area path</Trans>
						</Label>
						<Input
							id="azure-board-area"
							value={areaPath}
							onChange={(event) => setAreaPath(event.target.value)}
							placeholder={t({ message: "Project\\Team\\Area" })}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="azure-board-user">
							<Trans>Assigned-to fallback</Trans>
						</Label>
						<Input
							id="azure-board-user"
							value={assignedTo}
							onChange={(event) => setAssignedTo(event.target.value)}
							placeholder={t({ message: "Optional email for PAT logins" })}
						/>
						<p className="text-pretty text-xs text-muted-foreground">
							<Trans>
								Leave empty to use the identity reported by az account show.
							</Trans>
						</p>
					</div>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						className="h-10 transition-[transform,background-color] active:not-disabled:scale-[0.96]"
						onClick={() => onOpenChange(false)}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="button"
						className="h-10 transition-[transform,background-color] active:not-disabled:scale-[0.96]"
						disabled={!hostUrl || !isComplete || save.isPending}
						onClick={() => save.mutate()}
					>
						{save.isPending ? (
							<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
						) : null}
						<Trans>Connect board</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
