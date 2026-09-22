import { Trans } from "@lingui/react/macro";
import type { Item } from "@superset/chat/protocol";
import { formatNumber } from "@superset/i18n/format";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { CodexItem } from "../CodexItem/CodexItem";

function formatWorkDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts: string[] = [];
	if (hours) parts.push(`${formatNumber(hours)} h`);
	if (minutes) parts.push(`${formatNumber(minutes)} min`);
	if (seconds || parts.length === 0) parts.push(`${formatNumber(seconds)} s`);
	return parts.join(" ");
}

export function CodexWorkLog({
	items,
	startedAtMs,
	completedAtMs,
	running,
}: {
	items: Item[];
	startedAtMs: number;
	completedAtMs?: number;
	running: boolean;
}) {
	const reduce = useReducedMotion() ?? false;
	const [open, setOpen] = useState(running);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running]);

	useEffect(() => {
		if (running) {
			setOpen(true);
		} else {
			setOpen(false);
		}
	}, [running]);

	const duration = formatWorkDuration(
		Math.max(0, (completedAtMs ?? now) - startedAtMs),
	);

	return (
		<div className="border-b border-border/60">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className="flex min-h-10 w-full items-center gap-1.5 py-1 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:active:scale-100"
			>
				<span className="tabular-nums">
					{running ? (
						<Trans>Working for {duration}</Trans>
					) : (
						<Trans>Worked for {duration}</Trans>
					)}
				</span>
				<motion.span
					aria-hidden="true"
					animate={{ rotate: open ? 90 : 0 }}
					transition={
						reduce
							? { duration: 0 }
							: { type: "spring", duration: 0.3, bounce: 0 }
					}
				>
					<ChevronRight className="size-4" />
				</motion.span>
			</button>
			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						initial={reduce ? false : { height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
						transition={
							reduce
								? { duration: 0 }
								: { type: "spring", duration: 0.3, bounce: 0 }
						}
						className="overflow-hidden"
					>
						<div className="space-y-4 pb-4 pt-2">
							{items.map((item) => (
								<CodexItem
									key={item.id}
									item={item}
									running={running}
									onRespond={async () => undefined}
									onAnswer={async () => undefined}
								/>
							))}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
