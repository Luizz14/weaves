import { detectLspLanguage } from "@superset/shared/lsp";
import { useWorkspaceClient } from "@superset/workspace-client";
import { useCallback } from "react";
import {
	CommandPalette,
	type CommandPaletteProps,
} from "renderer/screens/main/components/CommandPalette";
import { usePrefetchFile } from "../../hooks/usePrefetchFile";
import { prefetchDocument } from "../../state/fileDocumentStore";
import { useLspCoordinator } from "../../state/lsp/LspProvider";

export function WorkspaceQuickOpen(
	props: Omit<CommandPaletteProps, "onHighlightFile" | "onOpenIntent">,
) {
	const { workspaceId, recentlyViewedFiles, openFilePaths } = props;
	const lsp = useLspCoordinator();
	const { trpcClient } = useWorkspaceClient();
	const prefetchFile = usePrefetchFile(workspaceId);
	const warmLastViewedProject = useCallback(() => {
		const recent = recentlyViewedFiles?.find(
			(file) =>
				detectLspLanguage(file.absolutePath) !== null &&
				!openFilePaths?.has(file.absolutePath),
		);
		if (!recent) return;
		prefetchDocument(workspaceId, recent.absolutePath, trpcClient);
		void lsp?.prefetch(recent.absolutePath);
	}, [recentlyViewedFiles, openFilePaths, workspaceId, trpcClient, lsp]);
	return (
		<CommandPalette
			{...props}
			onHighlightFile={prefetchFile}
			onOpenIntent={warmLastViewedProject}
		/>
	);
}
