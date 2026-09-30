import { cn } from "@superset/ui/utils";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
} from "react";
import { PANE_DOCK_ACTION_CLASS_NAME } from "./constants";
import { usePaneActionDock } from "./PaneActionLayoutContext";

interface PaneActionButtonProps extends ComponentPropsWithoutRef<"button"> {
	label: string;
	icon: ReactNode;
	iconClassName?: string;
}

export const PaneActionButton = forwardRef<
	HTMLButtonElement,
	PaneActionButtonProps
>(({ label, icon, children, className, iconClassName, ...props }, ref) => {
	const inDock = usePaneActionDock();
	return (
		<button
			ref={ref}
			type="button"
			aria-label={label}
			{...props}
			title={inDock ? undefined : props.title}
			className={
				inDock
					? cn(
							PANE_DOCK_ACTION_CLASS_NAME,
							props["aria-pressed"] === true && "bg-muted",
						)
					: className
			}
		>
			{inDock ? (
				<>
					<span
						className={cn(
							"flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4 [&>img]:size-4",
							iconClassName,
						)}
					>
						{icon}
					</span>
					<span className="min-w-0 truncate">{label}</span>
				</>
			) : (
				(children ?? icon)
			)}
		</button>
	);
});
