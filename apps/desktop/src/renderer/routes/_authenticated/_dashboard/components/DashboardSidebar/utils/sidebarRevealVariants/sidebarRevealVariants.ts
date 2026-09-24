import type { Variants } from "motion/react";

export const sidebarRevealListVariants: Variants = {
	open: {
		height: "auto",
		opacity: 1,
		transition: {
			height: { duration: 0.18, ease: [0.2, 0, 0, 1] },
			opacity: { duration: 0.12 },
			staggerChildren: 0.03,
		},
	},
	closed: {
		height: 0,
		opacity: 0,
		transition: {
			when: "afterChildren",
			height: { duration: 0.16, ease: [0.4, 0, 1, 1] },
			opacity: { duration: 0.1 },
			staggerChildren: 0.018,
			staggerDirection: -1,
		},
	},
};

export const sidebarRevealItemVariants: Variants = {
	open: {
		opacity: 1,
		y: 0,
		transition: { type: "spring", duration: 0.3, bounce: 0 },
	},
	closed: {
		opacity: 0,
		y: -6,
		transition: { duration: 0.1, ease: [0.4, 0, 1, 1] },
	},
};
