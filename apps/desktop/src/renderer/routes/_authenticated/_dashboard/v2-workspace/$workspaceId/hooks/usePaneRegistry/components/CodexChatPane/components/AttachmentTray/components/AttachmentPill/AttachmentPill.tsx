import { useLingui } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import {
	File as FileIcon,
	Loader2,
	RotateCcw,
	TriangleAlert,
	X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SPRING_SWAP } from "renderer/lib/ease";
import { cn } from "renderer/lib/utils";
import type { ChatAttachment } from "../../../../hooks/useChatAttachments";
import { type SizeUnit, toSizeParts } from "./utils/toSizeParts";

const ACTION_CLASS =
	"grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:cursor-default disabled:opacity-40 motion-reduce:active:scale-100";

export function AttachmentPill({
	attachment,
	disabled,
	onRemove,
	onRetry,
}: {
	attachment: ChatAttachment;
	disabled?: boolean;
	onRemove: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;
	const { value, unit } = toSizeParts(attachment.sizeBytes);
	const unitLabels: Record<SizeUnit, string> = {
		B: t({ message: "B", context: "file size unit, bytes" }),
		KB: t({ message: "KB", context: "file size unit, kilobytes" }),
		MB: t({ message: "MB", context: "file size unit, megabytes" }),
		GB: t({ message: "GB", context: "file size unit, gigabytes" }),
	};
	const size = `${formatNumber(value, {
		maximumFractionDigits: value < 10 && unit !== "B" ? 1 : 0,
	})} ${unitLabels[unit]}`;

	const uploading = attachment.state.kind === "uploading";
	const errored = attachment.state.kind === "error";
	const message =
		attachment.state.kind === "error" ? attachment.state.message : undefined;

	return (
		<div
			className={cn(
				"flex max-w-[15rem] items-center gap-2 rounded-[14px] border p-1.5 transition-[background-color,border-color] duration-150 ease-out",
				errored
					? "border-destructive/40 bg-destructive/10"
					: "border-border/60 bg-muted/40",
			)}
			title={message}
		>
			<span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-foreground/[0.06]">
				{attachment.previewUrl ? (
					<img
						alt={attachment.name}
						className="size-10 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
						src={attachment.previewUrl}
					/>
				) : (
					<FileIcon className="size-4 text-muted-foreground" />
				)}
				<AnimatePresence initial={false} mode="popLayout">
					{(uploading || errored) && (
						<motion.span
							animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
							className={cn(
								"absolute inset-0 grid place-items-center rounded-lg",
								errored ? "bg-destructive/30" : "bg-background/60",
							)}
							exit={
								reduce
									? { opacity: 0 }
									: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
							}
							initial={
								reduce
									? { opacity: 1 }
									: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
							}
							key={errored ? "error" : "uploading"}
							transition={reduce ? { duration: 0 } : SPRING_SWAP}
						>
							{errored ? (
								<TriangleAlert className="size-4 text-destructive" />
							) : (
								<Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
							)}
						</motion.span>
					)}
				</AnimatePresence>
			</span>

			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="min-w-0 truncate text-xs text-foreground/90">
					{attachment.name}
				</span>
				<span className="min-w-0 truncate text-[11px] text-muted-foreground tabular-nums">
					{errored ? message : size}
				</span>
			</span>

			{errored && onRetry && (
				<button
					aria-label={t({ message: "Retry upload" })}
					className={ACTION_CLASS}
					disabled={disabled}
					onClick={() => onRetry(attachment.id)}
					type="button"
				>
					<RotateCcw className="size-3.5" />
				</button>
			)}
			<button
				aria-label={t({ message: "Remove attachment" })}
				className={ACTION_CLASS}
				disabled={disabled}
				onClick={() => onRemove(attachment.id)}
				type="button"
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}
