import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar } from "@superset/ui/atoms/Avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SidebarOrganization } from "../../types";

const TRANSITION = { type: "spring", duration: 0.3, bounce: 0 } as const;

interface OrganizationSwitcherItemProps {
	organization: SidebarOrganization;
	isActive: boolean;
	isCollapsed: boolean;
	shortcut?: string;
	onSelect: () => void;
}

export function OrganizationSwitcherItem({
	organization,
	isActive,
	isCollapsed,
	shortcut,
	onSelect,
}: OrganizationSwitcherItemProps) {
	const reduceMotion = useReducedMotion() ?? false;
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: organization.id });
	const showLabel = isActive && !isCollapsed;

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				opacity: isDragging ? 0.58 : undefined,
			}}
			className={cn("relative shrink-0", isDragging && "z-20")}
		>
			<Tooltip delayDuration={350}>
				<TooltipTrigger asChild>
					<motion.button
						layout={reduceMotion ? false : "size"}
						{...attributes}
						{...listeners}
						type="button"
						aria-label={organization.name}
						aria-pressed={isActive}
						onClick={onSelect}
						transition={reduceMotion ? { duration: 0 } : TRANSITION}
						className={cn(
							"relative flex h-10 items-center overflow-hidden rounded-lg outline-none",
							"transition-[background-color,color,box-shadow,scale] active:scale-[0.96]",
							"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
							showLabel
								? "max-w-48 gap-2 px-2.5 text-foreground"
								: "w-10 justify-center text-muted-foreground hover:bg-fill-hover hover:text-foreground",
						)}
					>
						{isActive && (
							<motion.span
								layoutId="active-organization-background"
								transition={reduceMotion ? { duration: 0 } : TRANSITION}
								className="pointer-events-none absolute inset-0 rounded-lg bg-fill-selected shadow-sm dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
							/>
						)}
						<Avatar
							size="xs"
							fullName={organization.name}
							image={organization.logo}
							className="relative z-10 size-5 shrink-0 rounded-md ring-1 ring-black/10 ring-inset dark:ring-white/10"
						/>
						<AnimatePresence initial={false}>
							{showLabel && (
								<motion.span
									key="label"
									initial={
										reduceMotion
											? false
											: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
									}
									animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
									exit={
										reduceMotion
											? { opacity: 0 }
											: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
									}
									transition={reduceMotion ? { duration: 0 } : TRANSITION}
									className="relative z-10 min-w-0 truncate text-[13px] font-medium"
								>
									{organization.name}
								</motion.span>
							)}
						</AnimatePresence>
					</motion.button>
				</TooltipTrigger>
				<TooltipContent side={isCollapsed ? "right" : "top"}>
					<span>{organization.name}</span>
					{shortcut ? (
						<span className="ml-2 font-mono text-[10px] tabular-nums opacity-60">
							{shortcut}
						</span>
					) : null}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
