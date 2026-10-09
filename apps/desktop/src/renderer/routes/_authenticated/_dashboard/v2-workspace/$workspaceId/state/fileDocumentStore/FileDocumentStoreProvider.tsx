import type { ReactNode } from "react";
import { useWorkspaceEvent } from "renderer/hooks/host-service/useWorkspaceEvent";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { EditorAutomation } from "../lsp/EditorAutomation";
import { LspProvider } from "../lsp/LspProvider";
import { dispatchFsEvent } from "./fileDocumentStore";

export function FileDocumentStoreProvider({
	children,
	openFile,
	openFilePaths,
}: {
	children: ReactNode;
	openFile: (path: string) => void;
	openFilePaths: Set<string>;
}) {
	const { workspace } = useWorkspace();
	useWorkspaceEvent("fs:events", workspace.id, (event) => {
		dispatchFsEvent(workspace.id, event);
	});

	return (
		<LspProvider openFile={openFile} openFilePaths={openFilePaths}>
			<EditorAutomation>{children}</EditorAutomation>
		</LspProvider>
	);
}
