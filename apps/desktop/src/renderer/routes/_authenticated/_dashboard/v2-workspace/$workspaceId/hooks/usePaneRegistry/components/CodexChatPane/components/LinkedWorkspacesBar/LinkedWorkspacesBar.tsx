import { useLingui } from "@lingui/react/macro";
import { FolderGit2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_LAYOUT } from "renderer/lib/ease";

export function LinkedWorkspacesBar({
	workspaces,
	disabled,
	onRemove,
}: {
	workspaces: { id: string; name: string; branch?: string | null }[];
	disabled?: boolean;
	onRemove: (workspaceId: string) => void;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;

	if (workspaces.length === 0) return null;

	return (
		<ul
			aria-label={t({ message: "Linked workspaces" })}
			className="scrollbar-hide mb-2 flex gap-2 overflow-x-auto px-1 pb-1"
		>
			<AnimatePresence initial={false} mode="popLayout">
				{workspaces.map((workspace, index) => (
					<motion.li
						animate={{ opacity: 1, y: 0, scale: 1 }}
						className="flex min-w-0 max-w-56 shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-muted/20 p-1 pl-2.5"
						exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
						initial={
							reduce ? { opacity: 1 } : { opacity: 0, y: 6, scale: 0.96 }
						}
						key={workspace.id}
						layout={!reduce}
						transition={
							reduce
								? { duration: 0 }
								: {
										opacity: {
											duration: 0.18,
											ease: EASE_OUT,
											delay: Math.min(index, 4) * 0.03,
										},
										y: SPRING_LAYOUT,
										scale: SPRING_LAYOUT,
										layout: SPRING_LAYOUT,
									}
						}
					>
						<FolderGit2
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground"
						/>
						<span className="flex min-w-0 flex-col">
							<span className="min-w-0 truncate text-sm leading-tight">
								{workspace.name}
							</span>
							{workspace.branch ? (
								<span className="min-w-0 truncate text-muted-foreground text-xs leading-tight">
									{workspace.branch}
								</span>
							) : null}
						</span>
						<button
							aria-label={t({ message: `Unlink ${workspace.name}` })}
							className="relative grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-150 after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.96] disabled:opacity-40 motion-reduce:active:scale-100"
							disabled={disabled}
							onClick={() => onRemove(workspace.id)}
							type="button"
						>
							<X className="size-3.5" />
						</button>
					</motion.li>
				))}
			</AnimatePresence>
		</ul>
	);
}
