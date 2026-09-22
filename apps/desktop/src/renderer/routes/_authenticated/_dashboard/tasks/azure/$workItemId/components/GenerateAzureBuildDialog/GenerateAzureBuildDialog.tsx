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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { LuHammer, LuLoaderCircle } from "react-icons/lu";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import type { HostWorkspaceItem } from "renderer/hooks/host-workspaces/useHostWorkspaces";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

type GenerateAzureBuildDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workItemId: number;
	workspaces: HostWorkspaceItem[];
};

type BuildLane = "alpha" | "beta" | "release";

function workItemNumberFromBranch(branch: string): string {
	return /\d{4,}/.exec(branch)?.[0] ?? "";
}

export function GenerateAzureBuildDialog({
	open,
	onOpenChange,
	workItemId,
	workspaces,
}: GenerateAzureBuildDialogProps) {
	const { t } = useLingui();
	const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
	const [lane, setLane] = useState<BuildLane>("alpha");
	const [developerName, setDeveloperName] = useState("");
	const [versionName, setVersionName] = useState("");
	const [versionNumber, setVersionNumber] = useState("");
	const [addToMocks, setAddToMocks] = useState(false);
	const workspace = workspaces.find((item) => item.id === workspaceId);
	const hostUrl = useHostUrl(workspace?.hostId);
	const projectId = workspace?.projectId ?? null;
	const buildConfigQuery = useQuery({
		queryKey: ["azure-devops", "build-config", hostUrl, projectId],
		queryFn: () => {
			if (!hostUrl || !projectId)
				throw new Error("Build project is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.getBuildConfig.query({
				projectId,
			});
		},
		enabled: open && hostUrl !== null && projectId !== null,
	});
	const buildConfig = buildConfigQuery.data;
	const workItemNumber = workspace
		? workItemNumberFromBranch(workspace.branch)
		: "";
	const selectedNameIsValid = Boolean(
		buildConfig?.developerNames.includes(developerName),
	);
	const requiresVersion = lane !== "alpha";
	const canGenerate = Boolean(
		open &&
			hostUrl &&
			workspace &&
			buildConfig?.bitriseTokenConfigured &&
			selectedNameIsValid &&
			workItemNumber &&
			(!requiresVersion || versionName.trim()) &&
			(buildConfig?.platform !== "android" ||
				!requiresVersion ||
				versionNumber.trim()),
	);
	const versionPlaceholder = useMemo(
		() => (buildConfig?.platform === "android" ? "3.16.###" : "4.3.##"),
		[buildConfig?.platform],
	);

	useEffect(() => {
		if (!open) return;
		setWorkspaceId(workspaces[0]?.id ?? "");
		setLane("alpha");
		setDeveloperName("");
		setVersionName("");
		setVersionNumber("");
		setAddToMocks(false);
	}, [open, workspaces]);

	useEffect(() => {
		if (buildConfig?.developerNames[0]) {
			setDeveloperName(buildConfig.developerNames[0]);
		} else {
			setDeveloperName("");
		}
	}, [buildConfig]);

	const buildMutation = useMutation({
		mutationFn: () => {
			if (!hostUrl || !workspace)
				throw new Error("Build workspace is unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.generateBuild.mutate({
				workItemId,
				workspaceId: workspace.id,
				lane,
				developerName,
				versionName: versionName.trim() || undefined,
				versionNumber: versionNumber.trim() || undefined,
				addToMocks,
			});
		},
		onSuccess: (result) => {
			toast.success(t({ message: "Build started" }), {
				description: `${result.platform.toUpperCase()} · ${result.lane} · ${result.branch}`,
			});
			onOpenChange(false);
		},
		onError: (error) =>
			toast.error(errorMessage(error, t({ message: "Failed to start build" }))),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Generate mobile build</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Start a Bitrise build from a worktree linked to this Azure work
							item.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				{workspaces.length > 1 ? (
					<div className="grid gap-1.5">
						<Label htmlFor="azure-build-worktree">
							<Trans>Worktree and branch</Trans>
						</Label>
						<Select value={workspaceId} onValueChange={setWorkspaceId}>
							<SelectTrigger id="azure-build-worktree" className="h-10">
								<SelectValue placeholder={t({ message: "Select worktree" })} />
							</SelectTrigger>
							<SelectContent>
								{workspaces.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.branch}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : (
					<div className="grid gap-1.5">
						<Label>
							<Trans>Worktree branch</Trans>
						</Label>
						<div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm font-mono">
							{workspace?.branch ?? t({ message: "No linked worktree" })}
						</div>
					</div>
				)}

				{buildConfigQuery.isPending ? (
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<LuLoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
						<Trans>Loading project build settings…</Trans>
					</p>
				) : !hostUrl || !projectId ? (
					<p className="text-sm text-muted-foreground">
						<Trans>This worktree's host is unavailable.</Trans>
					</p>
				) : buildConfigQuery.error ? (
					<p className="text-sm text-destructive">
						{errorMessage(buildConfigQuery.error)}
					</p>
				) : !buildConfig ? (
					<p className="text-sm text-muted-foreground">
						<Trans>
							Configure mobile build generation in this project's Azure DevOps
							settings.
						</Trans>
					</p>
				) : !buildConfig.bitriseTokenConfigured ? (
					<p className="text-sm text-muted-foreground">
						<Trans>
							Add the Bitrise token in this project's Azure DevOps settings
							before generating a build.
						</Trans>
					</p>
				) : (
					<div className="grid gap-4">
						<div className="grid gap-1.5">
							<Label>
								<Trans>Platform</Trans>
							</Label>
							<div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
								{buildConfig.platform === "android" ? "Android" : "iOS"}
							</div>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="azure-build-lane">
								<Trans>Build type</Trans>
							</Label>
							<Select
								value={lane}
								onValueChange={(value) => {
									if (
										value === "alpha" ||
										value === "beta" ||
										value === "release"
									) {
										setLane(value);
									}
								}}
							>
								<SelectTrigger id="azure-build-lane" className="h-10">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="alpha">Alpha</SelectItem>
									<SelectItem value="beta">Beta</SelectItem>
									<SelectItem value="release">Release</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="azure-build-developer">
								<Trans>Developer name</Trans>
							</Label>
							<Select value={developerName} onValueChange={setDeveloperName}>
								<SelectTrigger id="azure-build-developer" className="h-10">
									<SelectValue placeholder={t({ message: "Select a name" })} />
								</SelectTrigger>
								<SelectContent>
									{buildConfig.developerNames.map((name) => (
										<SelectItem key={name} value={name}>
											{name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{requiresVersion ? (
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="grid gap-1.5">
									<Label htmlFor="azure-build-version-name">
										<Trans>Version name</Trans>
									</Label>
									<Input
										id="azure-build-version-name"
										value={versionName}
										onChange={(event) => setVersionName(event.target.value)}
										placeholder={versionPlaceholder}
										maxLength={80}
									/>
								</div>
								{buildConfig.platform === "android" ? (
									<div className="grid gap-1.5">
										<Label htmlFor="azure-build-version-number">
											<Trans>Version number</Trans>
										</Label>
										<Input
											id="azure-build-version-number"
											value={versionNumber}
											onChange={(event) => setVersionNumber(event.target.value)}
											placeholder={t({ message: "Build number" })}
											maxLength={80}
										/>
									</div>
								) : null}
							</div>
						) : (
							<p className="text-xs text-muted-foreground">
								<Trans>
									Alpha uses the configured version value for this project.
								</Trans>
							</p>
						)}

						{lane === "alpha" ? (
							<Checkbox
								checked={addToMocks}
								onCheckedChange={(checked) => setAddToMocks(checked === true)}
								label={t({ message: "Add this build to mocks" })}
								className="items-start text-sm"
							/>
						) : null}
						<div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
							<Trans>Work item number from branch:</Trans>{" "}
							{workItemNumber || t({ message: "Not found" })}
						</div>
					</div>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="button"
						disabled={!canGenerate || buildMutation.isPending}
						onClick={() => buildMutation.mutate()}
					>
						{buildMutation.isPending ? (
							<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
						) : (
							<LuHammer />
						)}
						<Trans>Start build</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
