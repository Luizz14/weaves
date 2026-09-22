import { useLingui } from "@lingui/react/macro";
import { formatDateTime } from "@superset/i18n/format";
import { cn } from "@superset/ui/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import type { HistoryCommit } from "../../types";
import { buildGraph } from "../../utils/buildGraph";
import { CommitGraph } from "../CommitGraph";
import { ColumnResizeHandle } from "./components/ColumnResizeHandle";

export function CommitList({
	commits,
	selected,
	onSelect,
}: {
	commits: HistoryCommit[];
	selected?: string;
	onSelect: (hash: string) => void;
}) {
	const { t } = useLingui();
	const parent = useRef<HTMLDivElement>(null);
	const [widths, setWidths] = useState<(number | null)[]>([
		null,
		150,
		80,
		140,
		190,
	]);
	const graph = useMemo(() => buildGraph(commits), [commits]);
	const graphWidth = graph.reduce(
		(width, row) => Math.max(width, row.width * 14 + 12),
		36,
	);
	const columns = [
		{ label: t({ message: "Commits" }), min: 240 },
		{ label: t({ message: "Branches" }), min: 80 },
		{ label: t({ message: "SHA" }), min: 64 },
		{ label: t({ message: "Author" }), min: 100 },
		{ label: t({ message: "Date" }), min: 144 },
	];
	const gridTemplateColumns = `${graphWidth}px ${widths.map((width, index) => (width === null ? `minmax(${columns[index]?.min ?? 240}px, 1fr)` : `${width}px`)).join(" ")} ${widths[0] === null ? "" : "minmax(0, 1fr)"}`;
	const minWidth =
		graphWidth +
		widths.reduce<number>(
			(sum, width, index) => sum + (width ?? columns[index]?.min ?? 0),
			0,
		);
	const virtual = useVirtualizer({
		count: commits.length,
		getScrollElement: () => parent.current,
		estimateSize: () => 40,
		overscan: 12,
		scrollPaddingStart: 40,
	});
	return (
		<div ref={parent} className="min-h-0 min-w-0 flex-1 overflow-auto">
			<div style={{ minWidth }}>
				<div
					className="sticky top-0 z-10 grid h-10 border-b bg-background text-xs text-muted-foreground"
					style={{ gridTemplateColumns }}
				>
					<span />
					{columns.map((column, index) => (
						<div
							key={column.label}
							className="relative flex min-w-0 items-center px-3 pr-4"
						>
							<span className="truncate">{column.label}</span>
							<ColumnResizeHandle
								label={column.label}
								width={widths[index] ?? column.min}
								minWidth={column.min}
								onResize={(width) =>
									setWidths((current) =>
										current.map((value, slot) =>
											slot === index ? width : value,
										),
									)
								}
							/>
						</div>
					))}
				</div>
				<div style={{ height: virtual.getTotalSize(), position: "relative" }}>
					{virtual.getVirtualItems().map((item) => {
						const commit = commits[item.index];
						const row = graph[item.index];
						if (!commit || !row) return null;
						return (
							<button
								key={commit.hash}
								type="button"
								aria-pressed={selected === commit.hash}
								data-commit-hash={commit.hash}
								tabIndex={selected === commit.hash ? 0 : -1}
								onClick={() => onSelect(commit.hash)}
								onKeyDown={(event) => {
									if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
										return;
									event.preventDefault();
									const next = Math.max(
										0,
										Math.min(
											commits.length - 1,
											item.index + (event.key === "ArrowDown" ? 1 : -1),
										),
									);
									const target = commits[next];
									if (target) {
										onSelect(target.hash);
										virtual.scrollToIndex(next);
										requestAnimationFrame(() =>
											parent.current
												?.querySelector<HTMLButtonElement>(
													`[data-commit-hash="${target.hash}"]`,
												)
												?.focus({ preventScroll: true }),
										);
									}
								}}
								className={cn(
									"absolute left-0 grid h-10 w-full items-center text-left text-xs transition-colors hover:bg-accent/60 focus-visible:z-10 focus-visible:outline focus-visible:outline-ring",
									selected === commit.hash &&
										"bg-accent text-accent-foreground",
								)}
								style={{ top: item.start, gridTemplateColumns }}
							>
								<CommitGraph row={row} width={graphWidth} />
								<span className="min-w-0 truncate px-3" title={commit.message}>
									{commit.message}
								</span>
								<span
									className="min-w-0 truncate px-3"
									title={commit.refs.join(", ")}
								>
									{commit.refs.length > 0 && (
										<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
											{commit.refs
												.map((ref) =>
													ref.replace(/refs\/(heads|remotes|tags)\//g, ""),
												)
												.join(", ")}
										</span>
									)}
								</span>
								<span
									className="truncate px-3 font-mono text-[10px] text-muted-foreground"
									title={commit.hash}
								>
									{commit.hash.slice(0, 7)}
								</span>
								<span
									className="truncate px-3 text-muted-foreground"
									title={commit.authorEmail}
								>
									{commit.author}
								</span>
								<time
									className="truncate px-3 text-muted-foreground tabular-nums"
									title={formatDateTime(new Date(commit.date))}
									dateTime={commit.date}
								>
									{formatDateTime(new Date(commit.date))}
								</time>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
