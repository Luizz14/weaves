import { useWorkspaceClient } from "@superset/workspace-client";
import { useCallback, useEffect, useRef } from "react";
import { prefetchDocument } from "../../state/fileDocumentStore";
import { useLspCoordinator } from "../../state/lsp/LspProvider";

const DWELL_MS = 120;

/**
 * Loads a file and opens it on its language server once the pointer or the
 * Quick Open highlight has rested on it, so opening it paints a ready editor.
 */
export function usePrefetchFile(
	workspaceId: string,
): (absolutePath: string | null) => void {
	const lsp = useLspCoordinator();
	const { trpcClient } = useWorkspaceClient();
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	return useCallback(
		(absolutePath: string | null) => {
			if (timer.current) clearTimeout(timer.current);
			timer.current = null;
			if (!absolutePath) return;
			timer.current = setTimeout(() => {
				timer.current = null;
				prefetchDocument(workspaceId, absolutePath, trpcClient);
				void lsp?.prefetch(absolutePath);
			}, DWELL_MS);
		},
		[workspaceId, trpcClient, lsp],
	);
}
