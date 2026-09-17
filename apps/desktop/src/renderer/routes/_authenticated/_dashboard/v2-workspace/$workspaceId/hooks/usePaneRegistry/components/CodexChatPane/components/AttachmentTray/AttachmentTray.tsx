import { useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_LAYOUT } from "renderer/lib/ease";
import type { ChatAttachment } from "../../hooks/useChatAttachments";
import { AttachmentPill } from "./components/AttachmentPill";

export function AttachmentTray({
	attachments,
	disabled,
	onRemove,
	onRetry,
}: {
	attachments: ChatAttachment[];
	disabled?: boolean;
	onRemove: (id: string) => void;
	/** Retry a failed upload; omit to hide the affordance. */
	onRetry?: (id: string) => void;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;

	if (attachments.length === 0) return null;

	return (
		<ul
			aria-label={t({ message: "Attachments" })}
			className="flex flex-wrap items-start gap-1.5 px-1 pb-1.5"
		>
			<AnimatePresence initial={false}>
				{attachments.map((attachment, index) => (
					<motion.li
						animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
						className="min-w-0"
						exit={
							reduce
								? { opacity: 0, transition: { duration: 0 } }
								: {
										opacity: 0,
										y: -6,
										filter: "blur(4px)",
										transition: { duration: 0.15, ease: EASE_OUT },
									}
						}
						initial={
							reduce
								? { opacity: 1 }
								: { opacity: 0, y: 6, scale: 0.96, filter: "blur(4px)" }
						}
						key={attachment.id}
						layout={!reduce}
						transition={
							reduce
								? { duration: 0 }
								: { ...SPRING_LAYOUT, delay: Math.min(index, 4) * 0.04 }
						}
					>
						<AttachmentPill
							attachment={attachment}
							disabled={disabled}
							onRemove={onRemove}
							onRetry={onRetry}
						/>
					</motion.li>
				))}
			</AnimatePresence>
		</ul>
	);
}
