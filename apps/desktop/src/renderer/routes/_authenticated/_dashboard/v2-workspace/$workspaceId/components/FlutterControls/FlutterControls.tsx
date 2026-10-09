import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceStore } from "@superset/panes";
import type {
	FlutterAction,
	FlutterSessionSnapshot,
} from "@superset/shared/flutter";
import { useWorkspaceClient, workspaceTrpc } from "@superset/workspace-client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	LuCode,
	LuMousePointer2,
	LuPlay,
	LuRefreshCw,
	LuRotateCcw,
	LuScan,
	LuScrollText,
	LuSquare,
	LuZap,
} from "react-icons/lu";
import {
	PaneActionButton,
	PaneActionLayoutContext,
} from "renderer/components/PaneActionButton";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import {
	getWorkspaceDocuments,
	observeDocumentSaves,
} from "../../state/fileDocumentStore/fileDocumentStore";
import { useLspCoordinator } from "../../state/lsp/LspProvider";
import type { FilePaneData, PaneViewerData } from "../../types";
import { FlutterControlsContext } from "./FlutterControlsContext";

export function FlutterControls({
	store,
	children,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	children: ReactNode;
}) {
	const { t } = useLingui();
	const { workspace } = useWorkspace();
	const { machineId } = useLocalHostService();
	const local = workspace.hostId === machineId;
	const focusedFile = useStore(store, (state) => {
		const tab = state.tabs.find((tab) => tab.id === state.activeTabId);
		const pane = tab?.activePaneId ? tab.panes[tab.activePaneId] : undefined;
		return pane?.kind === "file"
			? (pane.data as FilePaneData).filePath
			: undefined;
	});
	const lastFile = useRef<string | undefined>(undefined);
	if (focusedFile) lastFile.current = focusedFile;
	const activeFile = focusedFile ?? lastFile.current;
	const { trpcClient } = useWorkspaceClient();
	const lsp = useLspCoordinator();
	const [profileId, setProfileId] = useState("");
	const [deviceId, setDeviceId] = useState("");
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const profiles = workspaceTrpc.flutter.profiles.useQuery(
		{ workspaceId: workspace.id, activeFile },
		{ enabled: local, refetchInterval: 5000 },
	);
	const selected =
		profiles.data?.find((profile) => profile.id === profileId) ??
		profiles.data?.find((profile) => !profile.diagnostics.length) ??
		profiles.data?.[0];
	const devices = workspaceTrpc.flutter.devices.useQuery(
		{ workspaceId: workspace.id, profileId: selected?.id, activeFile },
		{
			enabled: local && !!selected && !selected.diagnostics.length,
			refetchOnWindowFocus: false,
		},
	);
	const status = workspaceTrpc.flutter.status.useQuery(
		{ workspaceId: workspace.id },
		{ enabled: local, refetchInterval: 500 },
	);
	const session = status.data;
	const phaseLabels = {
		starting: t({ message: "Starting" }),
		running: t({ message: "Running" }),
		reloading: t({ message: "Reloading" }),
		restarting: t({ message: "Restarting" }),
		stopping: t({ message: "Stopping" }),
		exited: t({ message: "Exited" }),
		error: t({ message: "Error" }),
	};
	const latest = useRef<FlutterSessionSnapshot | null>(null);
	latest.current = session ?? null;
	const active = session && !["exited", "error"].includes(session.phase);
	const location = useRef("");
	const observedSession = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!session) return;
		if (observedSession.current !== session.id) {
			observedSession.current = session.id;
			location.current = session.location
				? `${session.id}:${session.location.sequence}`
				: "";
			return;
		}
		if (!session.location) return;
		const key = `${session.id}:${session.location.sequence}`;
		if (location.current === key) return;
		location.current = key;
		void lsp?.revealFileLocation(
			session.location.path,
			session.location.line,
			session.location.column,
		);
	}, [session, lsp]);
	useEffect(() => {
		const saves = new Map<string, string>();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pending: string | undefined;
		let disposed = false;
		let inFlight = false;
		let queuedAt = 0;
		const reload = async () => {
			timer = undefined;
			let current: FlutterSessionSnapshot | null;
			try {
				current = await trpcClient.flutter.status.query({
					workspaceId: workspace.id,
				});
			} catch {
				pending = undefined;
				return;
			}
			if (
				!pending ||
				current?.id !== pending ||
				Date.now() - queuedAt > 60000
			) {
				pending = undefined;
				return;
			}
			if (inFlight || ["reloading", "restarting"].includes(current.phase)) {
				timer = setTimeout(reload, 300);
				return;
			}
			pending = undefined;
			if (current.phase !== "running" || !current.canReload) return;
			try {
				inFlight = true;
				await trpcClient.flutter.control.mutate({
					workspaceId: workspace.id,
					sessionId: current.id,
					action: "reload",
					reason: "save",
				});
			} catch (error) {
				if (!disposed) setError(String(error));
			} finally {
				inFlight = false;
			}
		};
		const unsubscribe = observeDocumentSaves((event) => {
			if (
				event.origin !== "manual" ||
				event.document.workspaceId !== workspace.id ||
				!event.document.absolutePath.endsWith(".dart")
			)
				return;
			if (event.phase === "start") {
				if (disposed) return;
				if (latest.current?.canReload)
					saves.set(event.requestId, latest.current.id);
				return;
			}
			const id = saves.get(event.requestId);
			saves.delete(event.requestId);
			if (
				!id ||
				event.result?.status !== "saved" ||
				latest.current?.id !== id
			) {
				if (disposed && saves.size === 0) unsubscribe();
				return;
			}
			pending = id;
			queuedAt = Date.now();
			if (disposed && saves.size === 0) unsubscribe();
			if (timer) clearTimeout(timer);
			timer = setTimeout(reload, 250);
		});
		return () => {
			disposed = true;
			if (saves.size === 0) unsubscribe();
		};
	}, [workspace.id, trpcClient]);
	async function saveBuffers() {
		for (const document of getWorkspaceDocuments(workspace.id)) {
			if (document.conflict)
				throw new Error(
					t({ message: "Resolve file conflicts before running Flutter" }),
				);
			if (!document.dirty && !document.pendingSave) continue;
			const result = await document.save({ origin: "flutter-action" });
			if (result.status !== "saved" || document.dirty)
				throw new Error(
					t({ message: "Save all files before running Flutter" }),
				);
		}
		if (
			getWorkspaceDocuments(workspace.id).some(
				(document) =>
					document.dirty || document.pendingSave || document.conflict,
			)
		)
			throw new Error(t({ message: "Save all files before running Flutter" }));
	}
	async function run(action?: FlutterAction) {
		setBusy(true);
		setError(undefined);
		try {
			if (!action || action === "reload" || action === "restart")
				await saveBuffers();
			if (action && session)
				await trpcClient.flutter.control.mutate({
					workspaceId: workspace.id,
					sessionId: session.id,
					action,
				});
			else if (selected)
				await trpcClient.flutter.start.mutate({
					workspaceId: workspace.id,
					profileId: selected.id,
					activeFile,
					hash: selected.hash,
					deviceId: selected.deviceId ?? deviceId,
				});
			await status.refetch();
		} catch (error) {
			setError(String(error));
		} finally {
			setBusy(false);
		}
	}
	function open(kind: "flutter-inspector" | "flutter-output") {
		if (!session) return;
		const state = store.getState();
		for (const tab of state.tabs) {
			const pane = Object.values(tab.panes).find(
				(pane) =>
					pane.kind === kind &&
					"sessionId" in pane.data &&
					pane.data.sessionId === session.id,
			);
			if (pane) {
				state.setActiveTab(tab.id);
				state.setActivePane({ tabId: tab.id, paneId: pane.id });
				return;
			}
		}
		state.addTab({ panes: [{ kind, data: { sessionId: session.id } }] });
	}
	const content =
		!local || (!profiles.data?.length && !session) ? null : (
			<PaneActionLayoutContext.Provider value={true}>
				<div className="flex max-h-[60vh] min-w-0 flex-col gap-1 overflow-y-auto text-xs">
					<div className="flex min-w-0 flex-col gap-0.5">
						<select
							aria-label={t({ message: "Flutter configuration" })}
							className="mb-1 h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-xs disabled:opacity-50"
							value={active ? "active-session" : (selected?.id ?? "")}
							disabled={!!active || busy}
							onChange={(event) => setProfileId(event.target.value)}
						>
							{active && (
								<option value="active-session">{session.profileName}</option>
							)}
							{profiles.data?.map((profile) => (
								<option key={profile.id} value={profile.id}>
									{profile.name}
									{profile.diagnostics.length ? " ⚠" : ""}
								</option>
							))}
						</select>
						<select
							aria-label={t({ message: "Flutter device" })}
							className="mb-1 h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-xs disabled:opacity-50"
							value={
								active ? session.deviceId : (selected?.deviceId ?? deviceId)
							}
							disabled={!!active || busy || !!selected?.deviceId}
							onChange={(event) => setDeviceId(event.target.value)}
						>
							{active && (
								<option value={session.deviceId}>{session.deviceId}</option>
							)}
							<option value="">
								<Trans>Select device</Trans>
							</option>
							{devices.data?.map((device) => (
								<option value={device.id} key={device.id}>
									{device.name}
								</option>
							))}
						</select>
						<PaneActionButton
							label={t({ message: "Refresh devices" })}
							icon={<LuRefreshCw className="size-4" />}
							onClick={() => void devices.refetch()}
							disabled={!!active || busy}
						/>
						{active ? (
							<>
								<output className="px-3 py-1.5 text-xs text-muted-foreground">
									{phaseLabels[session.phase]}
								</output>
								<PaneActionButton
									label={t({ message: "Hot reload" })}
									icon={<LuZap className="size-4" />}
									disabled={
										busy || session.phase !== "running" || !session.canReload
									}
									onClick={() => void run("reload")}
								/>
								<PaneActionButton
									label={t({ message: "Hot restart" })}
									icon={<LuRotateCcw className="size-4" />}
									disabled={
										busy || session.phase !== "running" || !session.canReload
									}
									onClick={() => void run("restart")}
								/>
								<PaneActionButton
									label={t({ message: "Stop" })}
									icon={<LuSquare className="size-4" />}
									disabled={busy}
									onClick={() => void run("stop")}
								/>
								<PaneActionButton
									label={t({ message: "Inspector" })}
									icon={<LuScan className="size-4" />}
									disabled={!session.canInspect}
									onClick={() => open("flutter-inspector")}
								/>
								<PaneActionButton
									label={t({ message: "Select widget" })}
									icon={<LuMousePointer2 className="size-4" />}
									aria-pressed={session.selectingWidget}
									disabled={
										busy || !session.canInspect || session.phase !== "running"
									}
									onClick={() => void run("select-widget")}
								/>
							</>
						) : (
							<PaneActionButton
								label={t({ message: "Run Flutter" })}
								icon={<LuPlay className="size-4" />}
								disabled={
									busy ||
									!selected ||
									!!selected.diagnostics.length ||
									!(selected.deviceId ?? deviceId)
								}
								onClick={() => void run()}
							/>
						)}
						{session && (
							<PaneActionButton
								label={t({ message: "Logs" })}
								icon={<LuScrollText className="size-4" />}
								onClick={() => open("flutter-output")}
							/>
						)}
						{session?.location && (
							<PaneActionButton
								label={t({ message: "Open widget source" })}
								icon={<LuCode className="size-4" />}
								onClick={() => {
									const target = session.location;
									if (target)
										void lsp?.revealFileLocation(
											target.path,
											target.line,
											target.column,
										);
								}}
							/>
						)}
					</div>
					{error ||
					devices.error ||
					session?.error ||
					selected?.diagnostics.length ? (
						<div
							role="alert"
							className="break-words px-3 py-1.5 text-xs text-destructive"
						>
							{error ??
								devices.error?.message ??
								session?.error ??
								selected?.diagnostics.join("; ")}
						</div>
					) : null}
				</div>
			</PaneActionLayoutContext.Provider>
		);
	return (
		<FlutterControlsContext.Provider value={content}>
			{children}
		</FlutterControlsContext.Provider>
	);
}
