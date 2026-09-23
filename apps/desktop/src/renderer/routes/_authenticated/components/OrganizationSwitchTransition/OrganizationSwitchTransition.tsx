import { Avatar } from "@superset/ui/atoms/Avatar";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AnimatedText } from "renderer/components/CodexModelSelector/components/AnimatedText";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";

const VISIBLE_MS = 1100;

export function OrganizationSwitchTransition() {
	const reduceMotion = useReducedMotion();
	const { activeOrganizationId } = useCollections();
	const { data: organizations } =
		cloudTrpc.organization.list.useQuery(undefined);
	const previousIdRef = useRef(activeOrganizationId);
	const [visibleId, setVisibleId] = useState<string | null>(null);
	const [showName, setShowName] = useState(false);

	useEffect(() => {
		if (previousIdRef.current === activeOrganizationId) return;
		previousIdRef.current = activeOrganizationId;
		setVisibleId(activeOrganizationId);
		setShowName(false);
		const frame = requestAnimationFrame(() => setShowName(true));
		const timer = setTimeout(() => setVisibleId(null), VISIBLE_MS);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	}, [activeOrganizationId]);

	const organization = organizations?.find((org) => org.id === visibleId);

	return (
		<AnimatePresence>
			{visibleId && organization && (
				<motion.div
					key={visibleId}
					aria-hidden
					initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
					animate={{ opacity: 1, backdropFilter: "blur(10px)" }}
					exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
					transition={{
						duration: reduceMotion ? 0 : 0.28,
						ease: [0.2, 0, 0, 1],
					}}
					className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center bg-background/55"
				>
					<motion.div
						initial={
							reduceMotion
								? false
								: { opacity: 0, scale: 0.86, y: 10, filter: "blur(6px)" }
						}
						animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
						exit={
							reduceMotion
								? undefined
								: { opacity: 0, scale: 1.04, y: -6, filter: "blur(4px)" }
						}
						transition={
							reduceMotion
								? { duration: 0 }
								: { type: "spring", duration: 0.5, bounce: 0.22 }
						}
						className="surface-outline flex items-center gap-3 rounded-3xl bg-background py-3 pr-5 pl-3 shadow-[0_8px_32px_#1a1a1a14]"
					>
						<motion.span
							initial={reduceMotion ? false : { rotate: -12, scale: 0.7 }}
							animate={{ rotate: 0, scale: 1 }}
							transition={
								reduceMotion
									? { duration: 0 }
									: { type: "spring", duration: 0.6, bounce: 0.35, delay: 0.05 }
							}
						>
							<Avatar
								size="lg"
								fullName={organization.name}
								image={organization.logo}
								className="rounded-xl ring-1 ring-black/10 ring-inset dark:ring-white/10"
							/>
						</motion.span>
						<AnimatedText
							value={showName ? organization.name : ""}
							className="text-base font-semibold"
						/>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
