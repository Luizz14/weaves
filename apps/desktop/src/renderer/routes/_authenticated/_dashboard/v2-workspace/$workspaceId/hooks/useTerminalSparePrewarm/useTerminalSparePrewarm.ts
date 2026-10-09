import { useWorkspaceClient } from "@superset/workspace-client";
import { useEffect } from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useTheme } from "renderer/stores/theme";
import { resolveTerminalThemeType } from "renderer/stores/theme/utils";
import { ensureSpareLease } from "../../utils/terminalSpareLeases";

/** Long enough that opening or switching to a workspace never waits on it. */
const PREWARM_DELAY_MS = 2_000;

/**
 * Keeps a shell started ahead of time for the workspace's next new terminal,
 * once the workspace has been open for a moment.
 */
export function useTerminalSparePrewarm(): void {
	const { workspace } = useWorkspace();
	const { trpcClient } = useWorkspaceClient();
	const activeTheme = useTheme();
	const themeType = resolveTerminalThemeType({
		activeThemeType: activeTheme?.type,
	});
	const workspaceId = workspace.id;

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void ensureSpareLease({
				workspaceId,
				themeType,
				prepare: () =>
					trpcClient.terminal.prepareSpare.mutate({ workspaceId, themeType }),
				release: (terminalId) =>
					trpcClient.terminal.releaseSpare.mutate({ terminalId }),
			});
		}, PREWARM_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [trpcClient, workspaceId, themeType]);
}
