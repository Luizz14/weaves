import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";
import type { ChangesViewMode } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import type { FoldSignal } from "../ChangesFileList";
import { ChangesSection } from "../ChangesFileList/components/ChangesSection";
import { FileRow } from "../ChangesFileList/components/FileRow";
import { useStagingMutations } from "../ChangesFileList/hooks/useStagingMutations";
import { LocalChangesDirectory } from "./components/LocalChangesDirectory";
import {
	buildLocalChangeRows,
	buildLocalChanges,
	filterLocalChanges,
	type LocalChangeEntry,
	type StagingFilter,
} from "./localChanges";

interface LocalChangesListProps {
	files: ChangesetFile[];
	workspaceId: string;
	viewMode: ChangesViewMode;
	selectedFilePath?: string;
	selectedChangeKey?: string;
	worktreePath?: string;
	foldSignal: FoldSignal;
	onSelectFile?: (
		path: string,
		openInNewTab?: boolean,
		changeKey?: string,
	) => void;
	onOpenFile?: (path: string, openInNewTab?: boolean) => void;
	onOpenInEditor?: (path: string) => void;
	isFiltered: boolean;
}
export function LocalChangesList({
	files,
	workspaceId,
	viewMode,
	selectedFilePath,
	worktreePath,
	foldSignal,
	onSelectFile,
	onOpenFile,
	onOpenInEditor,
	isFiltered,
}: LocalChangesListProps) {
	const { t } = useLingui();
	const [filter, setFilter] = useState<StagingFilter>("all");
	const [collapsed, setCollapsed] = useState(new Set<string>());
	const [pending, setPending] = useState(false);
	const [bulkPending, setBulkPending] = useState(false);
	const busy = useRef(false);
	const utils = workspaceTrpc.useUtils();
	const { stageFile, unstageFile } = useStagingMutations(workspaceId);
	const refresh = () =>
		Promise.all([
			utils.git.getStatus.invalidate({ workspaceId }),
			utils.git.getDiff.invalidate({ workspaceId }),
		]);
	const error = (failure: unknown) =>
		toast.error(
			errorMessage(failure, t({ message: "Couldn't update staging" })),
		);
	const stageAll = workspaceTrpc.git.stageAll.useMutation({
		onSuccess: refresh,
		onError: error,
	});
	const unstageAll = workspaceTrpc.git.unstageAll.useMutation({
		onSuccess: refresh,
		onError: error,
	});
	const entries = useMemo(() => buildLocalChanges(files), [files]);
	const visibleEntries = useMemo(
		() => filterLocalChanges(entries, filter),
		[entries, filter],
	);
	const rows = useMemo(
		() => buildLocalChangeRows(visibleEntries, viewMode === "tree", collapsed),
		[visibleEntries, viewMode, collapsed],
	);
	const listRef = useRef<HTMLFieldSetElement>(null);
	const [focusIndex, setFocusIndex] = useState<number | null>(null);
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () =>
			listRef.current?.closest<HTMLElement>(
				"[data-changes-scroll-container]",
			) ?? null,
		estimateSize: () => 24,
		overscan: 8,
		getItemKey: (index) => rows[index]?.key ?? index,
		scrollMargin: listRef.current?.offsetTop ?? 0,
		rangeExtractor: (range) =>
			[
				...new Set([
					...defaultRangeExtractor(range),
					...(focusIndex !== null && focusIndex < rows.length
						? [focusIndex]
						: []),
				]),
			].sort((a, b) => a - b),
	});
	useEffect(() => {
		if (focusIndex === null) return;
		const frame = requestAnimationFrame(() =>
			listRef.current
				?.querySelector<HTMLButtonElement>(
					`[data-change-row-index="${focusIndex}"] [data-change-navigation]`,
				)
				?.focus({ preventScroll: true }),
		);
		return () => cancelAnimationFrame(frame);
	}, [focusIndex]);

	const allStaged =
		entries.length > 0 && entries.every((entry) => entry.state === "staged");
	const bulkKind =
		filter === "staged" || (filter === "all" && allStaged)
			? "staged"
			: "unstaged";
	const hasBulkChanges = entries.some((entry) => !!entry[bulkKind]);
	const run = async (action: () => Promise<unknown>) => {
		if (busy.current || bulkPending) return;
		busy.current = true;
		setPending(true);
		try {
			await action();
		} catch {
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const toggleStage = (entry: LocalChangeEntry, staged: boolean) =>
		void run(() =>
			staged
				? stageFile(entry.unstaged ?? entry.primary)
				: unstageFile(entry.staged ?? entry.primary),
		);
	const toggleDirectory = useCallback(
		(path: string) =>
			setCollapsed((previous) => {
				const next = new Set(previous);
				if (next.has(path)) next.delete(path);
				else next.add(path);
				return next;
			}),
		[],
	);
	const lastFoldEpoch = useRef(0);
	useEffect(() => {
		if (!foldSignal.epoch || foldSignal.epoch === lastFoldEpoch.current) return;
		lastFoldEpoch.current = foldSignal.epoch;
		const paths = buildLocalChangeRows(entries, true, new Set()).flatMap(
			(row) => (row.kind === "directory" ? [row.path] : []),
		);
		setCollapsed(foldSignal.action === "collapse" ? new Set(paths) : new Set());
	}, [foldSignal, entries]);
	const navigate = (event: KeyboardEvent<HTMLFieldSetElement>) => {
		if (
			event.key !== "ArrowDown" &&
			event.key !== "ArrowUp" &&
			event.key !== "Home" &&
			event.key !== "End"
		)
			return;
		if (
			!(event.target instanceof HTMLElement) ||
			!event.target.matches("[data-change-navigation]")
		)
			return;
		const current = Number(
			event.target.closest<HTMLElement>("[data-change-row-index]")?.dataset
				.changeRowIndex ?? 0,
		);
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? rows.length - 1
					: Math.max(
							0,
							Math.min(
								rows.length - 1,
								current + (event.key === "ArrowDown" ? 1 : -1),
							),
						);
		event.preventDefault();
		virtualizer.scrollToIndex(next, { align: "auto" });
		setFocusIndex(next);
		if (next === focusIndex)
			listRef.current
				?.querySelector<HTMLButtonElement>(
					`[data-change-row-index="${next}"] [data-change-navigation]`,
				)
				?.focus();
	};
	const disabled = pending || bulkPending;
	return (
		<div
			className="flex min-h-0 flex-1 flex-col bg-background text-[15px]"
			style={{ fontFamily: '"Project Plex Sans", "IBM Plex Sans", sans-serif' }}
		>
			<div className="flex items-center gap-2 px-2 py-1">
				<Select
					value={filter}
					onValueChange={(value) => {
						if (value === "all" || value === "unstaged" || value === "staged")
							setFilter(value);
					}}
				>
					<SelectTrigger
						className="h-7 w-auto min-w-36 border-none bg-transparent px-2 text-xs shadow-none"
						aria-label={t({ message: "Staging filter" })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							<Trans>All local changes</Trans>
						</SelectItem>
						<SelectItem value="unstaged">
							<Trans>Unstaged</Trans>
						</SelectItem>
						<SelectItem value="staged">
							<Trans>Staged</Trans>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div
				className="relative min-h-0 flex-1 overflow-y-auto"
				data-changes-scroll-container
			>
				{entries.length === 0 ? (
					<p className="px-3 py-6 text-center text-sm text-muted-foreground">
						{isFiltered ? (
							<Trans>No files match your search</Trans>
						) : (
							<Trans>No changes</Trans>
						)}
					</p>
				) : (
					<ChangesSection
						sectionKey="local"
						title={t({ message: "Changes" })}
						count={visibleEntries.length}
						additions={visibleEntries.reduce(
							(sum, entry) => sum + (entry.primary.additions ?? 0),
							0,
						)}
						deletions={visibleEntries.reduce(
							(sum, entry) => sum + (entry.primary.deletions ?? 0),
							0,
						)}
						stagingActions={{
							kind: bulkKind,
							workspaceId,
						}}
						disabled={disabled || !hasBulkChanges}
						onPendingChange={setBulkPending}
						onStagingToggle={() =>
							void run(() =>
								bulkKind === "staged"
									? unstageAll.mutateAsync({ workspaceId })
									: stageAll.mutateAsync({ workspaceId }),
							)
						}
					>
						<fieldset
							onKeyDown={navigate}
							ref={listRef}
							className="relative min-w-0"
							style={{
								height: Math.max(
									rows.length === 0 ? 48 : 0,
									virtualizer.getTotalSize(),
								),
							}}
							aria-label={t({ message: "Changed files" })}
						>
							{rows.length === 0 && (
								<p className="px-3 py-4 text-xs text-muted-foreground">
									<Trans>No changes in this staging filter</Trans>
								</p>
							)}
							{virtualizer.getVirtualItems().map((virtualRow) => {
								const row = rows[virtualRow.index];
								if (!row) return null;
								return (
									<div
										key={row.key}
										data-change-row-index={virtualRow.index}
										className="absolute left-0 w-full"
										style={{
											top:
												virtualRow.start -
												(virtualizer.options.scrollMargin ?? 0),
										}}
									>
										{row.kind === "directory" ? (
											<LocalChangesDirectory
												key={row.key}
												path={row.path}
												count={row.count}
												depth={row.depth}
												open={!collapsed.has(row.path)}
												onToggle={() => toggleDirectory(row.path)}
												worktreePath={worktreePath}
												onOpenInEditor={onOpenInEditor}
											/>
										) : (
											<div
												key={row.key}
												style={{
													paddingLeft:
														viewMode === "tree"
															? `${row.depth * 20}px`
															: undefined,
												}}
											>
												<FileRow
													file={row.entry.primary}
													workspaceId={workspaceId}
													worktreePath={worktreePath}
													hideDir={viewMode === "tree"}
													isSelected={
														!!worktreePath &&
														selectedFilePath ===
															toAbsoluteWorkspacePath(
																worktreePath,
																row.entry.path,
															)
													}
													staging={row.entry}
													disabled={disabled}
													onToggleStage={(staged) =>
														toggleStage(row.entry, staged)
													}
													onSelect={onSelectFile}
													onOpenFile={onOpenFile}
													onOpenInEditor={onOpenInEditor}
												/>
											</div>
										)}
									</div>
								);
							})}
						</fieldset>
					</ChangesSection>
				)}
			</div>
		</div>
	);
}
