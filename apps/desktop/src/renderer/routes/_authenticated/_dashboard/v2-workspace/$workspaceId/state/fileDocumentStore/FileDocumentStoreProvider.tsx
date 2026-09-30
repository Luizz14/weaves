import type { ReactNode } from "react";
import { useWorkspaceEvent } from "renderer/hooks/host-service/useWorkspaceEvent";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { LspProvider } from "../lsp/LspProvider";
import { dispatchFsEvent } from "./fileDocumentStore";

export function FileDocumentStoreProvider({
	children,
	openFile,
}: {
	children: ReactNode;
	openFile: (path: string) => void;
}) {
	const { workspace } = useWorkspace();
	useWorkspaceEvent("fs:events", workspace.id, (event) => {
		dispatchFsEvent(workspace.id, event);
	});

	return <LspProvider openFile={openFile}>{children}</LspProvider>;
}
