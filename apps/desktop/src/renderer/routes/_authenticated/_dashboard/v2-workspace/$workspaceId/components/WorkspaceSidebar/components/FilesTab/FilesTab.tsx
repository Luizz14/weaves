import { Trans, useLingui } from "@lingui/react/macro";
import type {
	FileTreeRenameEvent,
	FileTreeRowDecoration,
	FileTreeRowDecorationContext,
	ContextMenuItem as PierreContextMenuItem,
	ContextMenuOpenContext as PierreContextMenuOpenContext,
} from "@pierre/trees";
import { FileTree } from "@pierre/trees";
import { FileTree as PierreFileTree } from "@pierre/trees/react";
import type { AppRouter } from "@superset/host-service";
import { formatNumber } from "@superset/i18n/format";
import { filePathToLspUri } from "@superset/shared/lsp";
import { workspaceTrpc } from "@superset/workspace-client";
import type { inferRouterOutputs } from "@trpc/server";
import { FilePlus, FolderPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGitStatusMap } from "renderer/hooks/host-service/useGitStatusMap";
import { useEditorSettings } from "renderer/hooks/useEditorSettings";
import {
	ShadowClickHint,
	usePierreRowClickPolicy,
	useSidebarFilePolicy,
} from "renderer/lib/clickPolicy";
import {
	loadZedIcons,
	visibleProjectPath,
	ZED_PANEL_CSS,
	zedPanelStyle,
} from "renderer/lib/zedProjectPanel/zedProjectPanel";
import { PierreRowContextMenu } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/PierreRowContextMenu";
import { useOpenInExternalEditor } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useOpenInExternalEditor";
import { usePrefetchFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePrefetchFile";
import { useLspCoordinator } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/LspProvider";
import { useResolvedTheme } from "renderer/stores/theme";
import { FileMenuItems } from "./components/FileMenuItems";
import { FilesTabDropOverlay } from "./components/FilesTabDropOverlay";
import { FilesTabHeaderButton } from "./components/FilesTabHeaderButton";
import { FolderMenuItems } from "./components/FolderMenuItems";
import { ProjectPanelMenu } from "./components/ProjectPanelMenu";
import { FILE_EXPLORER_OVERSCAN } from "./constants";
import { useFilesTabActions } from "./hooks/useFilesTabActions";
import { useFilesTabBridge } from "./hooks/useFilesTabBridge";
import { useFilesTabDrop } from "./hooks/useFilesTabDrop";
import { useFileTreeScrollFade } from "./hooks/useFileTreeScrollFade";
import { buildPierreGitStatus } from "./utils/buildPierreGitStatus";
import { stripTrailingSlash, toAbs, toRel } from "./utils/treePath";

type GitStatusData = inferRouterOutputs<AppRouter>["git"]["getStatus"];

interface FilesTabProps {
	onSelectFile: (absolutePath: string, openInNewTab?: boolean) => void;
	selectedFilePath?: string;
	pendingReveal?: {
		path: string;
		isDirectory: boolean;
	} | null;
	workspaceId: string;
	gitStatus: GitStatusData | undefined;
	onSearch?: () => void;
}

export function FilesTab({
	onSelectFile,
	selectedFilePath,
	pendingReveal,
	workspaceId,
	gitStatus,
	onSearch,
}: FilesTabProps) {
	const { t } = useLingui();
	const panel = useEditorSettings().panel;
	const theme = useResolvedTheme();
	const lsp = useLspCoordinator();

	const rowHeight = panel.density === "comfortable" ? 24 : 22;
	// Shares the query cache with V2WorkspacePage's workspace.get query, so
	// the first render after a workspace switch typically already has cached
	// data from React Query (the parent route resolves it first). staleTime
	// is set high enough that intra-session switches to a previously-visited
	// workspace render instantly without a refetch.
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspaceId },
		{ staleTime: 30_000 },
	);
	const rootPath = workspaceQuery.data?.worktreePath ?? "";

	const openInExternalEditor = useOpenInExternalEditor(workspaceId);
	const filePolicy = useSidebarFilePolicy();

	const { fileStatusByPath, folderStatusByPath, ignoredPaths } =
		useGitStatusMap(gitStatus);

	// Pierre's `gitStatus` is consumed only at construction; live updates
	// flow via model.setGitStatus in an effect below.
	const initialGitStatusEntriesRef = useRef(
		buildPierreGitStatus(fileStatusByPath, folderStatusByPath, ignoredPaths),
	);

	// Selection feedback loop guard: when the parent re-renders after we
	// fired onSelectFile, syncing selectedFilePath back into the model would
	// retrigger our onSelectionChange. Skip the next selection echo.
	const lastSelectedFromUserRef = useRef<string | null>(null);

	// `useFileTree` constructs the model once and never re-reads its options,
	// so any callback we pass directly would close over stale state. Route
	// every callback through a ref so we can update it on each render while
	// keeping a stable function identity for Pierre.
	const handlersRef = useRef({
		onSelect(_path: string) {},
		onRename(_event: FileTreeRenameEvent) {},
		onRenameError(_message: string) {},
		renderRowDecoration(
			_ctx: FileTreeRowDecorationContext,
		): FileTreeRowDecoration | null {
			return null;
		},
	});

	const modelOptions = {
		paths: [],
		initialExpansion: "closed",
		search: false,
		unsafeCSS: `${ZED_PANEL_CSS}
[data-file-tree-virtualized-root][data-scroll-at-top="true"] [data-file-tree-virtualized-sticky] {
	position: relative;
	top: auto !important;
	bottom: auto !important;
}
${panel.icons ? '[data-item-type="folder"] [data-item-section="icon"] svg { transform: none !important; rotate: none !important; }' : ""}
${panel.indentGuides ? "" : '[data-item-section="spacing-item"] { opacity: 0 !important; }'}
${panel.boldFolders ? '[data-item-type="folder"] { font-weight: 600; }' : '[data-item-type="folder"] { font-weight: 400; }'}
${panel.scrollbar === "never" ? "*::-webkit-scrollbar { display: none; }" : ""}
${panel.icons ? "" : '[data-item-type="file"] [data-item-section="icon"] { visibility: hidden; }'}`,
		renaming: {
			onRename: (event) => handlersRef.current.onRename(event),
			onError: (message) => handlersRef.current.onRenameError(message),
		},
		gitStatus: initialGitStatusEntriesRef.current,
		icons: { set: "minimal", colored: false },
		itemHeight: rowHeight,
		flattenEmptyDirectories: panel.compactFolders,
		overscan: FILE_EXPLORER_OVERSCAN,
		stickyFolders: panel.stickyScroll,
		onSelectionChange: (paths) => {
			const last = paths[paths.length - 1];
			if (!last) return;
			// Pierre uses trailing-slash paths for directories; we only fire
			// onSelectFile for files (clicking a folder toggles expansion).
			if (last.endsWith("/")) return;
			handlersRef.current.onSelect(last);
		},
		renderRowDecoration: (ctx) => handlersRef.current.renderRowDecoration(ctx),
	} satisfies ConstructorParameters<typeof FileTree>[0];
	const [model, setModel] = useState(() => new FileTree(modelOptions));
	const structure = `${rowHeight}:${panel.stickyScroll}:${panel.compactFolders}:${panel.indentGuides}:${panel.boldFolders}:${panel.scrollbar}:${panel.icons}`;
	const optionsRef = useRef(modelOptions);
	optionsRef.current = modelOptions;
	const lastStructure = useRef(structure);
	const scrollToRestore = useRef<{ top: number; left: number } | null>(null);
	const bridge = useFilesTabBridge({
		model,
		workspaceId,
		rootPath,
		isVisible: (path) => visibleProjectPath(path, panel, ignoredPaths),
		compactFolders: panel.compactFolders,
	});
	useEffect(() => {
		if (structure === lastStructure.current) return;
		const timer = setInterval(() => {
			const host = model.getFileTreeContainer();
			if (host?.shadowRoot?.querySelector('input[aria-label^="Rename"]'))
				return;
			const scroller = host?.shadowRoot?.querySelector<HTMLElement>(
				"[data-file-tree-virtualized-scroll]",
			);
			if (scroller)
				scrollToRestore.current = {
					top: scroller.scrollTop,
					left: scroller.scrollLeft,
				};
			const paths = [...bridge.knownPaths];
			const expanded = paths.filter((path) => {
				const item = model.getItem(path);
				return !!item && "isExpanded" in item && item.isExpanded();
			});
			const next = new FileTree({
				...optionsRef.current,
				paths,
				initialExpandedPaths: expanded,
				initialSelectedPaths: [...model.getSelectedPaths()],
			});
			lastStructure.current = structure;
			setModel(next);
			clearInterval(timer);
		}, 100);
		return () => clearInterval(timer);
	}, [structure, model, bridge.knownPaths]);
	useEffect(() => {
		if (!scrollToRestore.current) return;
		const timer = setInterval(() => {
			const scroller = model
				.getFileTreeContainer()
				?.shadowRoot?.querySelector<HTMLElement>(
					"[data-file-tree-virtualized-scroll]",
				);
			if (!scroller || !scrollToRestore.current) return;
			scroller.scrollTo(scrollToRestore.current);
			scrollToRestore.current = null;
			clearInterval(timer);
		}, 30);
		return () => clearInterval(timer);
	}, [model]);
	const filterSignature = `${workspaceId}:${panel.hideHidden}:${panel.hideIgnored}:${[...ignoredPaths].sort().join(";")}`;
	const lastFilters = useRef(filterSignature);
	useEffect(() => {
		if (lastFilters.current === filterSignature) return;
		lastFilters.current = filterSignature;
		void bridge.doRefresh();
	}, [filterSignature, bridge.doRefresh]);

	const {
		reveal,
		startCreating,
		handleRename,
		handleRenameError,
		handleDelete,
		collapseAll,
	} = useFilesTabActions({
		model,
		bridge,
		rootPath,
		workspaceId,
	});

	// Clicking blank space below the rows clears the selection, so "New Folder"
	// can target the workspace root.
	//
	// This sits on the tab's outermost element, so it sees every click in the
	// tab — including the header's own buttons, which bubble up here. Only a
	// click that reaches the empty tree viewport should deselect: Refresh or
	// Collapse All silently retargeting the next New Folder at the root would be
	// far worse than a sticky selection. Pierre renders rows in a shadow root
	// and stamps them with `data-item-path`, so walk composedPath() and bail on
	// a row, the header, or any interactive control.
	const handleTreeBackgroundClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			for (const node of event.nativeEvent.composedPath()) {
				if (!(node instanceof HTMLElement)) continue;
				if (
					node.dataset.itemPath !== undefined ||
					node.dataset.fileTreeHeader !== undefined ||
					node.closest("button, a, input, [role='button'], [role='menuitem']")
				) {
					return;
				}
			}
			for (const selectedPath of model.getSelectedPaths()) {
				model.getItem(selectedPath)?.deselect();
			}
		},
		[model],
	);

	const drop = useFilesTabDrop({ model, bridge, rootPath, workspaceId });
	const prefetchFile = usePrefetchFile(workspaceId);
	const handleHoverRowChange = useCallback(
		(row: HTMLElement | null) => {
			const treePath = row?.getAttribute("data-item-path");
			prefetchFile(rootPath && treePath ? toAbs(rootPath, treePath) : null);
		},
		[prefetchFile, rootPath],
	);

	// Push live git status updates into Pierre.
	useEffect(() => {
		model.setGitStatus(
			panel.gitStatus
				? buildPierreGitStatus(
						fileStatusByPath,
						folderStatusByPath,
						ignoredPaths,
					)
				: [],
		);
	}, [
		model,
		fileStatusByPath,
		folderStatusByPath,
		ignoredPaths,
		panel.gitStatus,
	]);

	const gitEntriesRef = useRef(
		buildPierreGitStatus(fileStatusByPath, folderStatusByPath, ignoredPaths),
	);
	gitEntriesRef.current = panel.gitStatus
		? buildPierreGitStatus(fileStatusByPath, folderStatusByPath, ignoredPaths)
		: [];
	useEffect(
		() =>
			lsp?.subscribeDiagnostics(() =>
				model.setGitStatus(gitEntriesRef.current),
			),
		[lsp, model],
	);

	useEffect(() => {
		if (!panel.icons) return;
		let cancelled = false;
		void loadZedIcons(theme.type)
			.then((icons) => {
				if (!cancelled) model.setIcons(icons);
			})
			.catch((error) => console.error("[project-panel] Icons failed", error));
		return () => {
			cancelled = true;
		};
	}, [model, theme.type, panel.icons]);
	useEffect(() => {
		if (!rootPath || !panel.icons) return;
		let observer: MutationObserver | undefined;
		const timer = setInterval(() => {
			const root = model.getFileTreeContainer()?.shadowRoot;
			if (!root) return;
			const update = () => {
				for (const row of root.querySelectorAll('[data-item-type="folder"]')) {
					const use = row.querySelector('[data-item-section="icon"] use');
					const icon =
						row.getAttribute("aria-expanded") === "true"
							? "#zed-folder-open"
							: "#zed-folder";
					if (use && use.getAttribute("href") !== icon)
						use.setAttribute("href", icon);
				}
			};
			observer = new MutationObserver(update);
			observer.observe(root, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: ["aria-expanded"],
			});
			update();
			clearInterval(timer);
		}, 30);
		return () => {
			clearInterval(timer);
			observer?.disconnect();
		};
	}, [model, rootPath, panel.icons]);

	// Reflect external selection changes (e.g. tab switch) back into the model.
	useEffect(() => {
		if (!selectedFilePath || !rootPath || !panel.autoReveal) return;
		if (lastSelectedFromUserRef.current === selectedFilePath) {
			lastSelectedFromUserRef.current = null;
			return;
		}
		const rel = toRel(rootPath, selectedFilePath);
		if (!bridge.knownPaths.has(rel)) return;
		model.focusPath(rel);
	}, [model, selectedFilePath, rootPath, bridge.knownPaths, panel.autoReveal]);

	useEffect(() => {
		if (!pendingReveal || !rootPath || !panel.autoReveal) return;
		void reveal(pendingReveal.path, pendingReveal.isDirectory);
	}, [pendingReveal, rootPath, reveal, panel.autoReveal]);

	// Wire the ref-based handlers so Pierre's stable callbacks always reach
	// the latest closures. Updated on every render — no diffing needed.
	handlersRef.current.onRename = (event) => void handleRename(event);
	handlersRef.current.onRenameError = (message) => handleRenameError(message);
	handlersRef.current.onSelect = (treePath) => {
		const abs = toAbs(rootPath, treePath);
		// Skip the reveal-induced echo. The reveal flow programmatically
		// selects the just-opened file's row, which fires onSelectionChange
		// synchronously. Without this guard, the echo re-enters onSelectFile
		// → openFilePaneFromTreeClick, which sees active === target and
		// pins the pane we just opened. Real keyboard nav (selection moves
		// to a different file) still gets through.
		if (selectedFilePath === abs) return;
		lastSelectedFromUserRef.current = abs;
		onSelectFile(abs);
	};
	// No-op: Pierre's setGitStatus already renders its own per-row status
	// indicator (and tints the row text), so a custom decoration here would
	// duplicate it. Kept the wiring in place in case we want to layer
	// something Pierre doesn't show (e.g. lock icons, debug markers).
	handlersRef.current.renderRowDecoration = (context) => {
		if (!panel.diagnostics || !lsp) return null;
		const uri = filePathToLspUri(toAbs(rootPath, context.item.path));
		let count = 0;
		for (const [path, diagnostics] of lsp.getDiagnostics())
			if (
				path === uri ||
				(context.item.kind === "directory" &&
					path.startsWith(uri.endsWith("/") ? uri : `${uri}/`))
			)
				count += diagnostics.errors + diagnostics.warnings;
		return count
			? { text: formatNumber(count), title: t({ message: "Diagnostics" }) }
			: null;
	};

	// Hint tooltip uses ShadowClickHint to anchor a single shadcn Tooltip
	// over the hovered row's bounding rect — Pierre owns the row DOM inside
	// an open shadow root, so per-row Tooltip wrappers aren't possible.
	// Folders are excluded since folder intents are hardcoded.
	// The hook fires Pierre's relative path; this surface's external
	// contract is absolute, so wrap each callback to join with `rootPath`.
	const { onClickCapture: handleClickCapture, findFileRow } =
		usePierreRowClickPolicy({
			filePolicy,
			onSelectFile: (rel, openInNewTab) =>
				onSelectFile(toAbs(rootPath, rel), openInNewTab),
			openInExternalEditor: (rel) => openInExternalEditor(toAbs(rootPath, rel)),
		});

	const renderContextMenu = useCallback(
		(item: PierreContextMenuItem, ctx: PierreContextMenuOpenContext) => {
			const isFolder = item.kind === "directory";
			const treePath = isFolder
				? `${stripTrailingSlash(item.path)}/`
				: item.path;
			const abs = toAbs(rootPath, item.path);
			const rel = stripTrailingSlash(item.path);
			return (
				<PierreRowContextMenu
					anchorRect={ctx.anchorRect}
					onClose={ctx.close}
					data-file-tree-context-menu-root="true"
				>
					{isFolder ? (
						<FolderMenuItems
							absolutePath={abs}
							relativePath={rel}
							onNewFile={() => void startCreating("file", abs)}
							onNewFolder={() => void startCreating("folder", abs)}
							onRename={() => model.startRenaming(treePath)}
							onDelete={() => handleDelete(abs, item.name, true)}
						/>
					) : (
						<FileMenuItems
							absolutePath={abs}
							relativePath={rel}
							onOpen={() => onSelectFile(abs)}
							onOpenInNewTab={() => onSelectFile(abs, true)}
							onOpenInEditor={() => openInExternalEditor(abs)}
							onRename={() => model.startRenaming(treePath)}
							onDelete={() => handleDelete(abs, item.name, false)}
						/>
					)}
				</PierreRowContextMenu>
			);
		},
		[
			rootPath,
			startCreating,
			handleDelete,
			onSelectFile,
			openInExternalEditor,
			model.startRenaming,
		],
	);

	const fadeContainerRef = useFileTreeScrollFade<HTMLDivElement>(
		Boolean(rootPath),
	);

	if (!rootPath) {
		return (
			<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
				{workspaceQuery.isLoading ? (
					<>
						<Loader2 className="size-3.5 animate-spin" />
						<span>
							<Trans>Loading files...</Trans>
						</span>
					</>
				) : (
					t({
						message: "Workspace worktree not available",
					})
				)}
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Drop zone for external file upload
		// biome-ignore lint/a11y/useKeyWithClickEvents: click target is the empty background below the rows, used only to clear the selection; keyboard users move between rows directly and never land on it
		<div
			ref={fadeContainerRef}
			className="group/project-panel relative flex h-full min-h-0 flex-col overflow-hidden"
			onClickCapture={handleClickCapture}
			onClick={handleTreeBackgroundClick}
			onDragOver={drop.onDragOver}
			onDragLeave={drop.onDragLeave}
			onDrop={drop.onDrop}
		>
			<ProjectPanelMenu
				newFile={() => void startCreating("file")}
				newFolder={() => void startCreating("folder")}
				refresh={() => void bridge.doRefresh()}
				collapse={collapseAll}
				search={onSearch}
			/>
			<ShadowClickHint
				hint={filePolicy.hint}
				findRow={findFileRow}
				onHoverRowChange={handleHoverRowChange}
			>
				<PierreFileTree
					model={model}
					className="flex-1 min-h-0"
					style={zedPanelStyle(panel, theme.type)}
					header={
						panel.hideRoot ? undefined : (
							<div
								data-file-tree-header="true"
								className="flex h-8 items-center gap-2 px-2 text-sm"
							>
								<span className="min-w-0 flex-1 truncate">
									{rootPath.split(/[\\/]/).pop()}
								</span>
								<FilesTabHeaderButton
									icon={FilePlus}
									label={t({ message: "New file" })}
									onClick={() => void startCreating("file")}
								/>
								<FilesTabHeaderButton
									icon={FolderPlus}
									label={t({ message: "New folder" })}
									onClick={() => void startCreating("folder")}
								/>
							</div>
						)
					}
					renderContextMenu={renderContextMenu}
				/>
			</ShadowClickHint>

			{drop.dropTarget && <FilesTabDropOverlay target={drop.dropTarget} />}
		</div>
	);
}
