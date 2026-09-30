import type { Variants } from "motion/react";

export function getSidebarRevealListVariants(
	itemCount: number,
	reduceMotion: boolean,
) {
	const intervals = Math.max(1, itemCount - 1);
	return {
		open: {
			height: "auto",
			opacity: 1,
			transition: {
				height: { duration: reduceMotion ? 0 : 0.18, ease: [0.2, 0, 0, 1] },
				opacity: { duration: reduceMotion ? 0 : 0.12 },
				staggerChildren: reduceMotion ? 0 : Math.min(0.03, 0.18 / intervals),
			},
		},
		closed: {
			height: 0,
			opacity: 0,
			transition: {
				when: "afterChildren",
				height: { duration: reduceMotion ? 0 : 0.16, ease: [0.4, 0, 1, 1] },
				opacity: { duration: reduceMotion ? 0 : 0.1 },
				staggerChildren: reduceMotion ? 0 : Math.min(0.018, 0.1 / intervals),
				staggerDirection: -1,
			},
		},
	} satisfies Variants;
}

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
