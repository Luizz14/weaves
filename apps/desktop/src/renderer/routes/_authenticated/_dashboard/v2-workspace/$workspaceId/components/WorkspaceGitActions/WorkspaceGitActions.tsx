import { BranchIntegrationControl } from "../BranchIntegrationControl";
import { PRStatusActions } from "../ChangesControl/components/PRStatusActions";
import { ShipControl } from "../ChangesControl/components/ShipControl";
import { usePRFlowState } from "../ChangesControl/hooks/usePRFlowState";

interface WorkspaceGitActionsProps {
	workspaceId: string;
	onOpenPullRequest?: (prNumber: number) => void;
}

export function WorkspaceGitActions({
	workspaceId,
	onOpenPullRequest,
}: WorkspaceGitActionsProps) {
	const { flowState, onRetry } = usePRFlowState(workspaceId);

	return (
		<div className="flex flex-col gap-2">
			<BranchIntegrationControl
				key={workspaceId}
				workspaceId={workspaceId}
				mode="dock"
			/>
			{flowState.kind === "no-pr" && (
				<ShipControl
					workspaceId={workspaceId}
					sync={flowState.sync}
					onRefresh={onRetry}
					dockMenu
				/>
			)}
			<PRStatusActions
				state={flowState}
				workspaceId={workspaceId}
				onRefresh={onRetry}
				onOpenPullRequest={onOpenPullRequest}
			/>
		</div>
	);
}
