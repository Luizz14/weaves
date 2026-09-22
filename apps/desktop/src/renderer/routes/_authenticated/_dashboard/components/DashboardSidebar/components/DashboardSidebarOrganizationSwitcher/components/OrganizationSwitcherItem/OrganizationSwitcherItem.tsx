import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar } from "@superset/ui/atoms/Avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedText } from "renderer/components/CodexModelSelector/components/AnimatedText";
import type { SidebarOrganization } from "../../types";

// Mirrors the segment-tab indicator glide (beui.dev/components/motion/tabs):
// settles without overshoot, since a shared-layout highlight bouncing past
// its target would read as jittery as it slides between organizations.
const INDICATOR_TRANSITION = {
	type: "spring",
	stiffness: 245,
	damping: 36,
	mass: 1.2,
} as const;

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
	const indicatorTransition = reduceMotion
		? { duration: 0 }
		: INDICATOR_TRANSITION;

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
						transition={indicatorTransition}
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
							// Shared layoutId "barrinha": rendered only for the active item, so
							// Motion treats it as one element gliding between positions when
							// the active organization changes, matching the segment-tab indicator.
							<motion.span
								layoutId="active-organization-background"
								layout
								transition={indicatorTransition}
								className="pointer-events-none absolute inset-0 rounded-lg bg-fill-selected shadow-sm dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
							/>
						)}
						<motion.span
							layout
							transition={indicatorTransition}
							className="relative z-10 shrink-0"
						>
							<Avatar
								size="xs"
								fullName={organization.name}
								image={organization.logo}
								className="size-5 shrink-0 rounded-md ring-1 ring-black/10 ring-inset dark:ring-white/10"
							/>
						</motion.span>
						{/* Same per-character reveal used by the Codex chat model selector:
						    letting the value go from "" to the name (and back) drives the
						    enter/exit through AnimatedText's own character transitions. */}
						<AnimatedText
							value={showLabel ? organization.name : ""}
							className="relative z-10 min-w-0 truncate text-[13px] font-medium"
						/>
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
