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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { useMemo, useState } from "react";
import { LuGitBranch, LuLoaderCircle } from "react-icons/lu";
import { useRecentProjects } from "renderer/hooks/host-projects/useRecentProjects";
import { useSelectedHostProjectIds } from "renderer/hooks/useSelectedHostProjectIds";
import { DevicePicker } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";
import { ProjectThumbnail } from "renderer/routes/_authenticated/components/ProjectThumbnail";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useWorkspaceCreates } from "renderer/stores/workspace-creates";

type CreateAzureWorktreeDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workItemId: number;
	workItemTitle: string;
	workItemUrl: string;
};

function slugify(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 52);
}

export function CreateAzureWorktreeDialog({
	open,
	onOpenChange,
	workItemId,
	workItemTitle,
	workItemUrl,
}: CreateAzureWorktreeDialogProps) {
	const { t } = useLingui();
	const { machineId } = useLocalHostService();
	const { otherHosts } = useWorkspaceHostOptions();
	const projects = useRecentProjects();
	const { submit } = useWorkspaceCreates();
	const [hostId, setHostId] = useState<string | null>(machineId);
	const setUpProjectIds = useSelectedHostProjectIds(hostId);
	const availableProjects = useMemo(
		() =>
			projects.filter(
				(project) => setUpProjectIds?.has(project.id) ?? hostId === machineId,
			),
		[hostId, machineId, projects, setUpProjectIds],
	);
	const [projectId, setProjectId] = useState<string | null>(
		availableProjects[0]?.id ?? null,
	);
	const [branch, setBranch] = useState(
		`feature/${workItemId}-${slugify(workItemTitle)}`,
	);
	const [isCreating, setIsCreating] = useState(false);
	const selectedProject = projects.find((project) => project.id === projectId);
	const remoteHostOffline =
		hostId !== null &&
		hostId !== machineId &&
		!otherHosts.find((host) => host.id === hostId)?.isOnline;

	const handleCreate = async () => {
		if (!hostId || !projectId || !branch.trim()) return;
		setIsCreating(true);
		try {
			const handle = submit({
				hostId,
				snapshot: {
					id: crypto.randomUUID(),
					projectId,
					name: workItemTitle,
					branch: branch.trim(),
					skipBranchPrefix: true,
					externalWorkItem: {
						provider: "azure-devops",
						id: String(workItemId),
						url: workItemUrl,
					},
				},
			});
			const outcome = await handle.completed;
			if (!outcome.ok) throw new Error(outcome.error);
			toast.success(t({ message: "Worktree created" }));
			onOpenChange(false);
		} catch (error) {
			toast.error(
				errorMessage(error, t({ message: "Failed to create worktree" })),
			);
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-balance">
						<Trans>Create worktree</Trans>
					</DialogTitle>
					<DialogDescription className="text-pretty">
						<Trans>
							Choose the device and project that will implement this Azure work
							item.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="grid gap-1.5">
						<Label>
							<Trans>Device</Trans>
						</Label>
						<DevicePicker hostId={hostId} onSelectHostId={setHostId} />
					</div>
					<div className="grid gap-1.5">
						<Label>
							<Trans>Project</Trans>
						</Label>
						<Select
							value={projectId ?? ""}
							onValueChange={(value) => setProjectId(value)}
						>
							<SelectTrigger className="h-10">
								<SelectValue placeholder={t({ message: "Select project" })} />
							</SelectTrigger>
							<SelectContent>
								{availableProjects.map((project) => (
									<SelectItem key={project.id} value={project.id}>
										<span className="flex items-center gap-2">
											<ProjectThumbnail
												projectName={project.name}
												iconUrl={project.iconUrl}
												className="size-4"
											/>
											{project.name}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="azure-worktree-branch">
							<Trans>Branch</Trans>
						</Label>
						<div className="relative">
							<LuGitBranch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="azure-worktree-branch"
								value={branch}
								onChange={(event) => setBranch(event.target.value)}
								className="h-10 pl-9 font-mono text-sm"
							/>
						</div>
						<p className="text-pretty text-xs text-muted-foreground">
							<Trans>
								You can edit the suggested branch before creating it.
							</Trans>
						</p>
					</div>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						className="h-10"
						onClick={() => onOpenChange(false)}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="button"
						className="h-10 transition-[transform,background-color] active:not-disabled:scale-[0.96]"
						disabled={
							!hostId ||
							!selectedProject ||
							!branch.trim() ||
							remoteHostOffline ||
							isCreating
						}
						onClick={() => void handleCreate()}
					>
						{isCreating ? (
							<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
						) : (
							<LuGitBranch />
						)}
						<Trans>Create worktree</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
