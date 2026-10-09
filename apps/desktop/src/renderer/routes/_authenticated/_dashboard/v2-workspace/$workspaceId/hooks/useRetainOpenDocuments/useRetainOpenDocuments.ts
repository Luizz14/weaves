import { useEffect } from "react";
import { setPinnedDocuments } from "../../state/fileDocumentStore";

export function useRetainOpenDocuments(
	workspaceId: string,
	openFilePaths: Set<string>,
): void {
	useEffect(() => {
		setPinnedDocuments(workspaceId, openFilePaths);
	}, [workspaceId, openFilePaths]);
	useEffect(() => () => setPinnedDocuments(workspaceId, []), [workspaceId]);
}
