import { useLingui } from "@lingui/react/macro";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { cn } from "@superset/ui/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	LuEllipsis,
	LuFolderOpen,
	LuGitBranch,
	LuSquareTerminal,
} from "react-icons/lu";

interface WorkspaceActionTab {
	id: "git" | "open" | "commands";
	label: string;
	icon: ReactNode;
	content: ReactNode;
}

interface WorkspaceActionDockProps {
	isCollapsed: boolean;
	compactPlacement?: "rail" | "tabbar";
	gitContent: ReactNode;
	openInContent: ReactNode;
	commandsContent: ReactNode;
}

const BAR_HEIGHT = 48;

export function WorkspaceActionDock({
	isCollapsed,
	compactPlacement = "rail",
	gitContent,
	openInContent,
	commandsContent,
}: WorkspaceActionDockProps) {
	const { t } = useLingui();
	const reduceMotion = useReducedMotion();
	const rootRef = useRef<HTMLDivElement>(null);
	const contentRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const [activeTab, setActiveTab] = useState<string | null>(null);
	const [compactOpen, setCompactOpen] = useState(false);
	const [contentHeights, setContentHeights] = useState<Record<string, number>>(
		{},
	);
	const [focusedIndex, setFocusedIndex] = useState(0);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const tabs = useMemo<WorkspaceActionTab[]>(
		() => [
			{
				id: "git",
				label: t({ message: "Git" }),
				icon: <LuGitBranch className="size-4" />,
				content: gitContent,
			},
			{
				id: "open",
				label: t({ message: "Open in" }),
				icon: <LuFolderOpen className="size-4" />,
				content: openInContent,
			},
			{
				id: "commands",
				label: t({ message: "Commands" }),
				icon: <LuSquareTerminal className="size-4" />,
				content: commandsContent,
			},
		],
		[t, gitContent, openInContent, commandsContent],
	);
	const active = tabs.find((tab) => tab.id === activeTab) ?? null;
	const activeHeight = active ? (contentHeights[active.id] ?? 0) : 0;
	const rootHeight = active
		? Math.max(BAR_HEIGHT, activeHeight + 60)
		: BAR_HEIGHT;

	const measureContent = useCallback(() => {
		const next: Record<string, number> = {};
		for (const [id, node] of Object.entries(contentRefs.current)) {
			if (node) next[id] = Math.ceil(node.scrollHeight);
		}
		setContentHeights((current) => {
			const unchanged = Object.keys(next).every(
				(id) => current[id] === next[id],
			);
			return unchanged ? current : next;
		});
	}, []);

	const observerRef = useRef<ResizeObserver | null>(null);
	useLayoutEffect(() => {
		const observer = new ResizeObserver(measureContent);
		observerRef.current = observer;
		for (const node of Object.values(contentRefs.current)) {
			if (node) observer.observe(node);
		}
		return () => {
			observer.disconnect();
			observerRef.current = null;
		};
	}, [measureContent]);

	const registerContent = useCallback(
		(id: string) => (node: HTMLDivElement | null) => {
			const previous = contentRefs.current[id];
			if (previous === node) return;
			if (previous) observerRef.current?.unobserve(previous);
			contentRefs.current[id] = node;
			if (node) {
				observerRef.current?.observe(node);
				measureContent();
			}
		},
		[measureContent],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: remeasure whenever the dock opens or switches tabs
	useLayoutEffect(() => {
		measureContent();
	}, [measureContent, activeTab, compactOpen]);

	useEffect(() => {
		if (!activeTab || isCollapsed) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				rootRef.current?.contains(target) ||
				target?.closest("[data-workspace-action-dock-portal]")
			) {
				return;
			}
			setActiveTab(null);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setActiveTab(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [activeTab, isCollapsed]);

	const focusTab = (index: number) => {
		const nextIndex = (index + tabs.length) % tabs.length;
		setFocusedIndex(nextIndex);
		tabRefs.current[nextIndex]?.focus();
	};

	const surface = (
		<motion.div
			ref={rootRef}
			initial={false}
			animate={{
				height: rootHeight,
				width: isCollapsed || active ? "100%" : 136,
			}}
			transition={
				reduceMotion
					? { duration: 0 }
					: isCollapsed
						? { duration: 0.22, ease: [0.2, 0, 0, 1] }
						: { type: "spring", duration: 0.48, bounce: 0.04 }
			}
			className="relative mx-auto max-w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_-1px_rgb(0_0_0/0.08),0_3px_8px_-3px_rgb(0_0_0/0.12)]"
		>
			<div
				className="absolute inset-x-2 top-2"
				style={{ bottom: BAR_HEIGHT + 8 }}
			>
				{tabs.map((tab) => {
					const selected = tab.id === activeTab;
					return (
						<motion.div
							key={tab.id}
							ref={registerContent(tab.id)}
							id={`workspace-actions-panel-${tab.id}`}
							role="tabpanel"
							aria-labelledby={`workspace-actions-tab-${tab.id}`}
							aria-hidden={!selected}
							inert={!selected}
							initial={false}
							animate={{
								opacity: selected ? 1 : 0,
								y: selected ? 0 : -3,
							}}
							transition={
								reduceMotion
									? { duration: 0 }
									: { duration: selected ? 0.14 : 0.1, ease: [0.2, 0, 0, 1] }
							}
							className={cn(
								"w-full",
								selected
									? "relative"
									: "invisible pointer-events-none absolute inset-x-0 top-0",
							)}
						>
							{tab.content}
						</motion.div>
					);
				})}
			</div>

			<div
				role="tablist"
				aria-label={t({ message: "Workspace actions" })}
				aria-orientation="horizontal"
				className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 p-1"
				style={{ height: BAR_HEIGHT }}
			>
				{tabs.map((tab, index) => {
					const selected = tab.id === activeTab;
					return (
						<button
							key={tab.id}
							ref={(node) => {
								tabRefs.current[index] = node;
							}}
							id={`workspace-actions-tab-${tab.id}`}
							type="button"
							role="tab"
							aria-selected={selected}
							aria-controls={`workspace-actions-panel-${tab.id}`}
							aria-label={tab.label}
							title={tab.label}
							tabIndex={focusedIndex === index ? 0 : -1}
							onClick={() => {
								setFocusedIndex(index);
								setActiveTab(selected && !isCollapsed ? null : tab.id);
							}}
							onKeyDown={(event) => {
								if (event.key === "ArrowRight") {
									event.preventDefault();
									focusTab(index + 1);
								} else if (event.key === "ArrowLeft") {
									event.preventDefault();
									focusTab(index - 1);
								} else if (event.key === "Home") {
									event.preventDefault();
									focusTab(0);
								} else if (event.key === "End") {
									event.preventDefault();
									focusTab(tabs.length - 1);
								}
							}}
							className={cn(
								"flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium outline-none transition-[background-color,color,transform] duration-150 active:scale-[0.96]",
								"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
								selected
									? "bg-muted text-foreground shadow-sm"
									: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
							)}
						>
							{tab.icon}
							<AnimatePresence initial={false}>
								{selected && (
									<motion.span
										initial={{ opacity: 0, width: 0, filter: "blur(4px)" }}
										animate={{ opacity: 1, width: "auto", filter: "blur(0px)" }}
										exit={{ opacity: 0, width: 0, filter: "blur(4px)" }}
										transition={
											reduceMotion
												? { duration: 0 }
												: { type: "spring", duration: 0.3, bounce: 0 }
										}
										className="overflow-hidden whitespace-nowrap"
									>
										{tab.label}
									</motion.span>
								)}
							</AnimatePresence>
						</button>
					);
				})}
			</div>
		</motion.div>
	);

	const compactPopover = (
		<Popover
			open={compactOpen}
			onOpenChange={(open) => {
				setCompactOpen(open);
				setActiveTab((current) => (open ? (current ?? "git") : null));
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={t({ message: "Workspace actions" })}
					aria-expanded={compactOpen}
					title={t({ message: "Workspace actions" })}
					className={cn(
						"group flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-[background-color,color,transform] duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]",
						compactPlacement === "tabbar"
							? "bg-transparent"
							: "border border-border/70 bg-card shadow-sm hover:bg-muted",
					)}
				>
					<span
						className={cn(
							"flex items-center justify-center rounded-lg transition-[background-color,border-color,box-shadow] duration-150",
							compactPlacement === "tabbar"
								? "size-8 border border-border/70 bg-card shadow-sm group-hover:bg-muted"
								: "size-10",
						)}
					>
						<LuEllipsis className="size-4" />
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				forceMount
				align="end"
				side="left"
				sideOffset={8}
				aria-hidden={!compactOpen}
				inert={!compactOpen}
				style={{ animation: "none" }}
				className="w-72 border-0 bg-transparent p-0 shadow-none data-[state=closed]:invisible data-[state=open]:visible data-[state=closed]:animate-none data-[state=open]:animate-none"
				data-workspace-action-dock-portal="true"
				onInteractOutside={(event) => {
					const target = event.target as HTMLElement | null;
					if (target?.closest("[data-workspace-action-dock-portal]")) {
						event.preventDefault();
					}
				}}
			>
				<motion.div
					initial={false}
					animate={
						compactOpen
							? { opacity: 1, scale: 1, x: 0 }
							: { opacity: 0, scale: 0.96, x: 6 }
					}
					transition={
						reduceMotion
							? { duration: 0 }
							: compactOpen
								? { type: "spring", duration: 0.32, bounce: 0.08 }
								: { duration: 0 }
					}
					style={{ transformOrigin: "top right" }}
				>
					{surface}
				</motion.div>
			</PopoverContent>
		</Popover>
	);

	if (isCollapsed) {
		return compactPlacement === "tabbar" ? (
			<div className="flex h-10 shrink-0 items-center px-1">
				{compactPopover}
			</div>
		) : (
			<div className="flex shrink-0 justify-center px-1.5 pb-2">
				{compactPopover}
			</div>
		);
	}

	return <div className="shrink-0 px-3 pb-2">{surface}</div>;
}
