import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { sidebarRevealItemVariants } from "../../utils/sidebarRevealVariants";

/** A row inside `SidebarRevealList`; inherits the list's open/closed state. */
export function SidebarRevealItem({
	children,
	disabled = false,
}: {
	children: ReactNode;
	disabled?: boolean;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<motion.div
			variants={
				reduceMotion || disabled ? undefined : sidebarRevealItemVariants
			}
		>
			{children}
		</motion.div>
	);
}
