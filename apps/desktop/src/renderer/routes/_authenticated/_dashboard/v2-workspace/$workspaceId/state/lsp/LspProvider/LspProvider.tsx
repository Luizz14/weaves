import { lspUriToFilePath } from "@superset/shared/lsp";
import { useWorkspaceClient } from "@superset/workspace-client";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { useEditorSettings } from "renderer/hooks/useEditorSettings";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { LspCoordinator } from "../coordinator";

const LspContext = createContext<LspCoordinator | null>(null);

export function LspProvider({
	children,
	openFile,
	openFilePaths,
}: {
	children: ReactNode;
	openFile: (path: string) => void;
	openFilePaths: Set<string>;
}) {
	const connection = useWorkspaceClient();
	const preferences = useEditorSettings();
	const { workspace } = useWorkspace();
	const { machineId } = useLocalHostService();
	const openFileRef = useRef(openFile);
	openFileRef.current = openFile;
	const { hostUrl, trpcClient, getWsToken, queryClient } = connection;
	const coordinator = useMemo(
		() =>
			workspace.hostId === machineId
				? new LspCoordinator(
						workspace.id,
						{ hostUrl, trpcClient, getWsToken, queryClient },
						(path) => openFileRef.current(path),
						lspUriToFilePath,
					)
				: null,
		[
			workspace.id,
			workspace.hostId,
			machineId,
			hostUrl,
			trpcClient,
			getWsToken,
			queryClient,
		],
	);
	useEffect(() => () => coordinator?.dispose(), [coordinator]);
	useEffect(() => {
		coordinator?.configure(preferences);
	}, [coordinator, preferences]);
	useEffect(() => {
		coordinator?.setBackgroundFiles(openFilePaths);
	}, [coordinator, openFilePaths]);
	return (
		<LspContext.Provider value={coordinator}>{children}</LspContext.Provider>
	);
}

export function useLspCoordinator() {
	return useContext(LspContext);
}
