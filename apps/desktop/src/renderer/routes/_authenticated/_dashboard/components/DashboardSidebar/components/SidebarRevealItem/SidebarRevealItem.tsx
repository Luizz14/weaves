import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { sidebarRevealItemVariants } from "../../utils/sidebarRevealVariants";

/** A row inside `SidebarRevealList`; inherits the list's open/closed state. */
export function SidebarRevealItem({ children }: { children: ReactNode }) {
	const reduceMotion = useReducedMotion();
	return (
		<motion.div variants={reduceMotion ? undefined : sidebarRevealItemVariants}>
			{children}
		</motion.div>
	);
}
