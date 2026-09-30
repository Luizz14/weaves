import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { ButtonGroup } from "@superset/ui/button-group";
import { useState } from "react";
import { LuChevronDown, LuHammer, LuLoaderCircle } from "react-icons/lu";
import { GenerateAzureBuildDialog } from "../GenerateAzureBuildDialog";
import {
	type AzureBuildWorkspace,
	useAzureBuild,
	workItemNumberFromBranch,
} from "./hooks/useAzureBuild";

export function AzureBuildAction({
	workspace,
	workItemId,
	projectName,
}: {
	workspace: AzureBuildWorkspace;
	workItemId: number;
	projectName: string;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const { configQuery, generate, isPending, hostUrl } = useAzureBuild({
		workspace,
		workItemId,
		onStarted: () => setOpen(false),
	});
	const config = configQuery.data;
	if (
		!hostUrl ||
		configQuery.isError ||
		!config?.bitriseTokenConfigured ||
		config.developerNames.length === 0
	)
		return null;
	const developerName = config.developerNames[0];
	const disabled = isPending || !workItemNumberFromBranch(workspace.branch);
	const customizeLabel = t({ message: "Customize mobile build" });
	return (
		<>
			<ButtonGroup aria-label={t({ message: "Generate mobile build" })}>
				<Button
					variant="outline"
					size="sm"
					className="h-10"
					disabled={disabled || open}
					onClick={() => {
						if (config.developerNames.length === 1 && developerName)
							generate({
								lane: "alpha",
								developerName,
								addToMocks: false,
							});
						else setOpen(true);
					}}
				>
					{isPending ? (
						<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
					) : (
						<LuHammer />
					)}
					<Trans>Generate build</Trans>
				</Button>
				<Button
					variant="outline"
					size="icon"
					className="size-10"
					disabled={disabled || open}
					aria-label={customizeLabel}
					title={customizeLabel}
					aria-haspopup="dialog"
					onClick={() => setOpen(true)}
				>
					<LuChevronDown />
				</Button>
			</ButtonGroup>
			{open && (
				<GenerateAzureBuildDialog
					open={open}
					onOpenChange={setOpen}
					workspace={workspace}
					projectName={projectName}
					buildConfig={config}
					onGenerate={generate}
					isPending={isPending}
				/>
			)}
		</>
	);
}
