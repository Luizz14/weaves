import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { sidebarRevealListVariants } from "../../utils/sidebarRevealVariants";

interface SidebarRevealListProps {
	open: boolean;
	children: ReactNode;
	className?: string;
}

/**
 * Collapsible sidebar list: height folds while `SidebarRevealItem` rows
 * cascade in top-down on open and out bottom-up on close. Lists already open
 * on first render don't animate.
 */
export function SidebarRevealList({
	open,
	children,
	className,
}: SidebarRevealListProps) {
	const reduceMotion = useReducedMotion();
	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					variants={sidebarRevealListVariants}
					initial="closed"
					animate="open"
					exit="closed"
					transition={reduceMotion ? { duration: 0 } : undefined}
					className={
						className ? `overflow-hidden ${className}` : "overflow-hidden"
					}
				>
					{children}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
