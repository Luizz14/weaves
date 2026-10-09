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
import { useActiveOrganizationId } from "renderer/hooks/useActiveOrganizationId";
import { useEditorSettings } from "renderer/hooks/useEditorSettings";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { LspCoordinator } from "../coordinator";
import {
	acquireCoordinator,
	disposeIdleCoordinatorsOutside,
	getCoordinator,
	releaseCoordinator,
} from "./coordinatorRegistry";

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
	const organizationId = useActiveOrganizationId();
	const openFileRef = useRef(openFile);
	openFileRef.current = openFile;
	const { hostUrl, trpcClient, getWsToken, queryClient } = connection;
	const key =
		workspace.hostId === machineId ? `${workspace.id}\n${hostUrl}` : null;
	const coordinator = useMemo(
		() =>
			key
				? getCoordinator(
						key,
						organizationId,
						() =>
							new LspCoordinator(
								workspace.id,
								{ hostUrl, trpcClient, getWsToken, queryClient },
								() => {},
								lspUriToFilePath,
							),
					)
				: null,
		[
			key,
			organizationId,
			workspace.id,
			hostUrl,
			trpcClient,
			getWsToken,
			queryClient,
		],
	);
	useEffect(() => {
		disposeIdleCoordinatorsOutside(organizationId);
	}, [organizationId]);
	useEffect(() => {
		if (!key || !coordinator) return;
		acquireCoordinator(key);
		coordinator.setOpenFile((path) => openFileRef.current(path));
		return () => {
			coordinator.setOpenFile(() => {});
			releaseCoordinator(key);
		};
	}, [key, coordinator]);
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
