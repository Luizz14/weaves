import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "renderer/lib/utils";

const NUMBER_TRANSITION = {
	type: "spring",
	stiffness: 520,
	damping: 38,
	mass: 0.7,
} as const;

const REDUCED_NUMBER_TRANSITION = { duration: 0 } as const;

export type AnimatedNumberProps = Omit<
	ComponentPropsWithoutRef<"span">,
	"children"
> & {
	value: number | string;
};

export function AnimatedNumber({
	value,
	className,
	...props
}: AnimatedNumberProps) {
	const reduce = useReducedMotion() ?? false;
	const formattedValue = String(value);
	const transition = reduce ? REDUCED_NUMBER_TRANSITION : NUMBER_TRANSITION;

	return (
		<span {...props} className={cn("inline-flex tabular-nums", className)}>
			<span className="sr-only">{formattedValue}</span>
			{Array.from(formattedValue).map((character, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: each position is a persistent digit column.
					key={index}
					aria-hidden="true"
					className="relative inline-flex min-w-[0.62ch] overflow-hidden align-baseline"
				>
					<AnimatePresence initial={false} mode="popLayout">
						<motion.span
							key={character}
							initial={
								reduce
									? false
									: { y: "-0.65em", opacity: 0, filter: "blur(2px)" }
							}
							animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
							exit={
								reduce
									? undefined
									: { y: "0.65em", opacity: 0, filter: "blur(2px)" }
							}
							transition={transition}
							className="inline-block"
						>
							{character}
						</motion.span>
					</AnimatePresence>
				</span>
			))}
		</span>
	);
}
