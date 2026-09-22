import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { LuGitBranch, LuSettings2 } from "react-icons/lu";

interface WorkspaceActionTab {
	id: "git" | "other";
	label: string;
	icon: ReactNode;
	content: ReactNode;
}

interface WorkspaceActionDockProps {
	gitContent: ReactNode;
	otherContent: ReactNode;
}

const BAR_HEIGHT = 48;

export function WorkspaceActionDock({
	gitContent,
	otherContent,
}: WorkspaceActionDockProps) {
	const { t } = useLingui();
	const reduceMotion = useReducedMotion();
	const rootRef = useRef<HTMLDivElement>(null);
	const contentRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const [activeTab, setActiveTab] = useState<string | null>(null);
	const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
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
				id: "other",
				label: t({ message: "Actions" }),
				icon: <LuSettings2 className="size-4" />,
				content: otherContent,
			},
		],
		[t, gitContent, otherContent],
	);
	const active = tabs.find((tab) => tab.id === activeTab) ?? null;
	const activeHeight = active ? (contentHeights[active.id] ?? 0) : 0;
	const rootHeight = active
		? Math.max(BAR_HEIGHT, activeHeight + 60)
		: BAR_HEIGHT;

	const measureContent = useCallback(() => {
		const next: Record<string, number> = {};
		for (const tab of tabs) {
			const node = contentRefs.current[tab.id];
			if (node) next[tab.id] = Math.ceil(node.scrollHeight);
		}
		setContentHeights((current) => {
			const unchanged = tabs.every((tab) => current[tab.id] === next[tab.id]);
			return unchanged ? current : next;
		});
	}, [tabs]);

	useLayoutEffect(() => {
		measureContent();
		const observer = new ResizeObserver(measureContent);
		for (const tab of tabs) {
			const node = contentRefs.current[tab.id];
			if (node) observer.observe(node);
		}
		return () => observer.disconnect();
	}, [measureContent, tabs]);

	useEffect(() => {
		if (!activeTab) return;
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
	}, [activeTab]);

	const focusTab = (index: number) => {
		const nextIndex = (index + tabs.length) % tabs.length;
		setFocusedIndex(nextIndex);
		tabRefs.current[nextIndex]?.focus();
	};

	return (
		<div className="shrink-0 px-3 pb-2">
			<motion.div
				ref={rootRef}
				initial={false}
				animate={{ height: rootHeight, width: active ? "100%" : 96 }}
				transition={
					reduceMotion
						? { duration: 0 }
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
								ref={(node) => {
									contentRefs.current[tab.id] = node;
								}}
								id={`workspace-actions-panel-${tab.id}`}
								role="tabpanel"
								aria-labelledby={`workspace-actions-tab-${tab.id}`}
								aria-hidden={!selected}
								inert={!selected}
								initial={false}
								animate={{
									opacity: selected ? 1 : 0,
									y: selected ? 0 : -5,
									filter: reduceMotion
										? "blur(0px)"
										: selected
											? "blur(0px)"
											: "blur(3px)",
								}}
								transition={
									reduceMotion
										? { duration: 0 }
										: { duration: selected ? 0.2 : 0.12, ease: [0.2, 0, 0, 1] }
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
									setActiveTab(selected ? null : tab.id);
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
		</div>
	);
}
