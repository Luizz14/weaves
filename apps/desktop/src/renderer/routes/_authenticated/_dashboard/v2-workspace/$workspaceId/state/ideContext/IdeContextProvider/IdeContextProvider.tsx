import type { WorkspaceStore } from "@superset/panes";
import { IDE_CONTEXT_REFRESH_MS } from "@superset/shared/ide-context";
import { useWorkspaceClient } from "@superset/workspace-client";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
} from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../../types";
import {
	getDocument,
	observeDocuments,
} from "../../fileDocumentStore/fileDocumentStore";
import { IdeContextModel } from "../model";

const IdeContext = createContext<IdeContextModel | null>(null);

export function useIdeContext(): IdeContextModel | null {
	return useContext(IdeContext);
}

export function IdeContextProvider({
	children,
	store,
	ready,
}: {
	children: ReactNode;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	ready: boolean;
}) {
	const { workspace } = useWorkspace();
	const { trpcClient, hostUrl } = useWorkspaceClient();
	const model = useMemo(
		() =>
			new IdeContextModel(
				{
					workspaceId: workspace.id,
					organizationId: workspace.organizationId,
					hostUrl,
				},
				() => store.getState(),
				(path) => getDocument(workspace.id, path),
			),
		[workspace.id, workspace.organizationId, hostUrl, store],
	);

	useEffect(() => {
		if (!ready) return;
		const producerId = crypto.randomUUID();
		let sequence = 0;
		let stopped = false;
		let inFlight = false;
		let requested = false;
		let activated = document.hasFocus();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const subscriptions = new Map<string, () => void>();
		const publish = () => {
			if (stopped) return;
			requested = true;
			if (inFlight) return;
			requested = false;
			inFlight = true;
			const snapshot = model.snapshot(producerId, ++sequence, activated);
			activated = false;
			void trpcClient.ideContext.publish
				.mutate(snapshot)
				.catch(() => {})
				.finally(() => {
					inFlight = false;
					if (requested && !stopped) publish();
				});
		};
		const schedule = () => {
			activated ||= document.hasFocus();
			clearTimeout(timeout);
			timeout = setTimeout(publish, 75);
		};
		const focus = () => {
			activated = true;
			publish();
		};
		window.addEventListener("focus", focus);
		const unsubscribeModel = model.subscribe(schedule);
		const unsubscribeLayout = store.subscribe(schedule);
		const unsubscribeDocuments = observeDocuments((document) => {
			if (
				document.workspaceId !== workspace.id ||
				subscriptions.has(document.id)
			)
				return;
			if (subscriptions.size >= 100) return;
			subscriptions.set(document.id, document.subscribe(schedule));
		});
		const interval = setInterval(publish, IDE_CONTEXT_REFRESH_MS);
		publish();
		return () => {
			stopped = true;
			window.removeEventListener("focus", focus);
			clearTimeout(timeout);
			clearInterval(interval);
			unsubscribeModel();
			unsubscribeLayout();
			unsubscribeDocuments();
			for (const unsubscribe of subscriptions.values()) unsubscribe();
			void trpcClient.ideContext.clear
				.mutate({ workspaceId: workspace.id, producerId, sequence: ++sequence })
				.catch(() => {});
		};
	}, [model, trpcClient, ready, workspace.id, store]);

	return <IdeContext.Provider value={model}>{children}</IdeContext.Provider>;
}
