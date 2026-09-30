"use client";

import { useLingui } from "@lingui/react/macro";
import { SquareMousePointer } from "lucide-react";
import { cn } from "../../../../../../lib/utils";
import { Toggle } from "../../../../../ui/toggle";

interface CommentModeButtonProps {
	className?: string;
	showLabel?: boolean;
	enabled: boolean;
	openCount: number;
	onToggle: () => void;
	compact?: boolean;
}

export function CommentModeButton({
	className,
	showLabel = false,
	enabled,
	openCount,
	onToggle,
	compact = false,
}: CommentModeButtonProps) {
	const { t } = useLingui();
	const label = enabled
		? t({ message: "Leave comment mode" })
		: t({ message: "Comment on this page" });

	if (compact) {
		return (
			<Toggle
				size="sm"
				pressed={enabled}
				onPressedChange={onToggle}
				aria-label={label}
				title={label}
				className="h-6 min-w-6 gap-1 px-1 text-muted-foreground/60 hover:text-muted-foreground data-[state=on]:text-foreground"
			>
				<SquareMousePointer className="size-3.5" />
				{openCount > 0 ? (
					<span className="font-medium text-[11px] tabular-nums">
						{openCount}
					</span>
				) : null}
			</Toggle>
		);
	}

	return (
		<Toggle
			size="sm"
			pressed={enabled}
			onPressedChange={onToggle}
			aria-label={label}
			title={label}
			className={cn("h-7 min-w-7 gap-1.5 px-2", className)}
		>
			<SquareMousePointer className="size-3.5 shrink-0" />
			{showLabel && <span className="min-w-0 truncate">{label}</span>}
			{openCount > 0 ? (
				<span className="font-medium text-xs tabular-nums">{openCount}</span>
			) : null}
		</Toggle>
	);
}
