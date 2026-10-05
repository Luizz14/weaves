import { Trans, useLingui } from "@lingui/react/macro";
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
import { useEffect, useMemo, useState } from "react";
import { LuHammer, LuLoaderCircle } from "react-icons/lu";

import {
	type AzureBuildConfig,
	type AzureBuildOptions,
	type AzureBuildWorkspace,
	workItemNumberFromBranch,
} from "../AzureBuildAction/hooks/useAzureBuild";

type GenerateAzureBuildDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspace: AzureBuildWorkspace;
	projectName: string;
	buildConfig: AzureBuildConfig;
	onGenerate: (options: AzureBuildOptions) => void;
	isPending: boolean;
};

type BuildLane = "alpha" | "beta" | "release";

export function GenerateAzureBuildDialog({
	open,
	onOpenChange,
	workspace,
	projectName,
	buildConfig,
	onGenerate,
	isPending,
}: GenerateAzureBuildDialogProps) {
	const { t } = useLingui();
	const [lane, setLane] = useState<BuildLane>("alpha");
	const [developerName, setDeveloperName] = useState(
		buildConfig.developerNames[0] ?? "",
	);
	const [versionName, setVersionName] = useState("");
	const [versionNumber, setVersionNumber] = useState("");
	const [addToMocks, setAddToMocks] = useState(false);
	const workItemNumber = workItemNumberFromBranch(workspace.branch);
	const selectedNameIsValid = Boolean(
		buildConfig.developerNames.includes(developerName),
	);
	const requiresVersion = lane !== "alpha";
	const canGenerate = Boolean(
		open &&
			buildConfig.bitriseTokenConfigured &&
			selectedNameIsValid &&
			workItemNumber &&
			(!requiresVersion || versionName.trim()) &&
			(buildConfig.platform !== "android" ||
				!requiresVersion ||
				versionNumber.trim()),
	);
	const versionPlaceholder = useMemo(
		() => (buildConfig.platform === "android" ? "3.16.###" : "4.3.##"),
		[buildConfig.platform],
	);

	useEffect(() => {
		setDeveloperName((current) =>
			buildConfig.developerNames.includes(current)
				? current
				: (buildConfig.developerNames[0] ?? ""),
		);
	}, [buildConfig.developerNames]);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!isPending) onOpenChange(next);
			}}
		>
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

				<div className="grid gap-1.5">
					<Label>
						<Trans>Worktree branch</Trans>
					</Label>
					<div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
						<p className="font-medium">{projectName}</p>
						<p className="break-all font-mono">{workspace.branch}</p>
					</div>
				</div>

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
						<div className="flex items-center gap-2">
							<Checkbox
								id="azure-build-mocks"
								checked={addToMocks}
								onCheckedChange={(checked) => setAddToMocks(checked === true)}
							/>
							<Label htmlFor="azure-build-mocks">
								<Trans>Add this build to mocks</Trans>
							</Label>
						</div>
					) : null}
					<div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
						<Trans>Work item number from branch:</Trans>{" "}
						{workItemNumber || t({ message: "Not found" })}
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={isPending}
						onClick={() => onOpenChange(false)}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						type="button"
						disabled={!canGenerate || isPending}
						onClick={() =>
							onGenerate({
								lane,
								developerName,
								versionName: versionName.trim() || undefined,
								versionNumber: versionNumber.trim() || undefined,
								addToMocks: lane === "alpha" && addToMocks,
							})
						}
					>
						{isPending ? (
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
