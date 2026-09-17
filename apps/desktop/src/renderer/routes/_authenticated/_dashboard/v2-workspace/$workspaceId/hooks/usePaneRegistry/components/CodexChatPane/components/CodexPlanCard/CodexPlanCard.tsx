import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Check, ClipboardList, Copy, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { cn } from "renderer/lib/utils";
import { CodexMarkdown } from "../CodexMarkdown/CodexMarkdown";

export function CodexPlanCard({
	text,
	running,
	onImplement,
	className,
}: {
	text: string;
	running: boolean;
	onImplement?: (plan: string) => Promise<boolean>;
	className?: string;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;
	const { copyToClipboard, copied } = useCopyToClipboard();
	const [starting, setStarting] = useState(false);
	const label = running
		? t({ message: "Planning" })
		: t({ message: "Implementation plan" });

	return (
		<section
			aria-label={t({ message: "Implementation plan" })}
			className={cn(
				"w-full overflow-hidden rounded-2xl border border-border/70 bg-muted/20",
				className,
			)}
		>
			<header className="flex h-11 items-center gap-2.5 border-b border-border/60 px-3.5">
				<span
					aria-hidden="true"
					className="relative grid size-5 shrink-0 place-items-center text-muted-foreground"
				>
					<ClipboardList className="size-4" />
					{running && (
						<motion.span
							className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-foreground/70"
							animate={reduce ? undefined : { opacity: [1, 0.25, 1] }}
							transition={{ duration: 1.2, repeat: Infinity }}
						/>
					)}
				</span>
				<h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
					{label}
				</h3>
				<Button
					aria-label={
						copied ? t({ message: "Copied" }) : t({ message: "Copy" })
					}
					className="size-7 shrink-0 text-muted-foreground"
					onClick={() => void copyToClipboard(text)}
					size="icon"
					title={copied ? t({ message: "Copied" }) : t({ message: "Copy" })}
					variant="ghost"
				>
					{copied ? (
						<Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
					) : (
						<Copy className="size-3.5" />
					)}
				</Button>
			</header>
			<div className="px-3.5 py-1">
				<CodexMarkdown text={text} />
			</div>
			{onImplement && !running && (
				<footer className="flex justify-end border-t border-border/60 px-3.5 py-2">
					<Button
						className="min-h-9"
						disabled={starting}
						onClick={() => {
							setStarting(true);
							void onImplement(text).finally(() => setStarting(false));
						}}
						size="sm"
					>
						<Play className="size-3.5" />
						<Trans>Implement plan</Trans>
					</Button>
				</footer>
			)}
		</section>
	);
}
