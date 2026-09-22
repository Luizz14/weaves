import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { VscAzureDevops } from "react-icons/vsc";

type AzureDevOpsEmptyStateProps = {
	onConnect: () => void;
	canConnect: boolean;
};

export function AzureDevOpsEmptyState({
	onConnect,
	canConnect,
}: AzureDevOpsEmptyStateProps) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-8">
			<div className="flex max-w-md flex-col items-center text-center">
				<div className="flex size-12 items-center justify-center rounded-2xl bg-[#0078d4]/10 text-[#0078d4] shadow-[0_0_0_1px_rgb(0_120_212/0.16),0_8px_24px_rgb(0_0_0/0.05)]">
					<VscAzureDevops className="size-6" />
				</div>
				<h2 className="mt-5 text-balance text-lg font-semibold">
					<Trans>Connect your Azure DevOps board</Trans>
				</h2>
				<p className="mt-2 text-pretty text-sm text-muted-foreground">
					<Trans>
						Bring the current sprint into Superset, claim work items, and keep
						worktrees and pull requests together.
					</Trans>
				</p>
				<Button
					type="button"
					className="mt-5 h-10 transition-[transform,background-color,box-shadow] duration-150 active:not-disabled:scale-[0.96]"
					disabled={!canConnect}
					onClick={onConnect}
				>
					<VscAzureDevops />
					<Trans>Connect Azure DevOps</Trans>
				</Button>
			</div>
		</div>
	);
}
