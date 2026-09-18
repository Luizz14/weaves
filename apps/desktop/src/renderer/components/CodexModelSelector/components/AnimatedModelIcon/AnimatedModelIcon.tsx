import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ModelIcon } from "../ModelIcon/ModelIcon";

export function AnimatedModelIcon({
	modelId,
	className,
}: {
	modelId: string;
	className?: string;
}) {
	const reduce = useReducedMotion() ?? false;

	return (
		<span
			className={`relative grid shrink-0 place-items-center ${className ?? "size-4"}`}
		>
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span
					key={modelId}
					initial={
						reduce
							? { opacity: 1 }
							: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
					}
					animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
					exit={
						reduce
							? { opacity: 0 }
							: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
					}
					transition={
						reduce
							? { duration: 0 }
							: { type: "spring", duration: 0.3, bounce: 0 }
					}
					className="absolute inset-0 grid place-items-center"
				>
					<ModelIcon modelId={modelId} className="size-full" />
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
