import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "renderer/lib/utils";

const TEXT_TRANSITION = {
	type: "spring" as const,
	duration: 0.3,
	bounce: 0,
};

export function AnimatedText({
	value,
	className,
}: {
	value: string;
	className?: string;
}) {
	const reduce = useReducedMotion() ?? false;

	return (
		<motion.span
			layout={reduce ? false : "position"}
			aria-label={value}
			className={cn("relative inline-flex", className)}
		>
			<AnimatePresence initial={false} mode="popLayout">
				{Array.from(value).map((character, index) => (
					<motion.span
						key={`${value}-${index}-${character}`}
						aria-hidden="true"
						layout={reduce ? false : "position"}
						initial={
							reduce
								? { opacity: 1 }
								: {
										opacity: 0,
										transform: "translateY(0.45em)",
										filter: "blur(3px)",
									}
						}
						animate={{
							opacity: 1,
							transform: "translateY(0)",
							filter: "blur(0px)",
						}}
						exit={
							reduce
								? { opacity: 0 }
								: {
										opacity: 0,
										transform: "translateY(-0.35em)",
										filter: "blur(3px)",
									}
						}
						transition={reduce ? { duration: 0 } : TEXT_TRANSITION}
						className="inline-block"
					>
						{character === " " ? "\u00a0" : character}
					</motion.span>
				))}
			</AnimatePresence>
		</motion.span>
	);
}
