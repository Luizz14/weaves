import type { Theme } from "shared/themes";

const TRANSITION_CLASS =
	"transition-[background-color,color,border-color] duration-200 ease-out";

interface ThemeLivePreviewProps {
	theme: Theme;
}

/**
 * A tiny non-interactive mockup of the app chrome, recolored live from the
 * theme being edited. Gives an at-a-glance sense of how the palette reads
 * together without leaving the dialog.
 */
export function ThemeLivePreview({ theme }: ThemeLivePreviewProps) {
	const { ui } = theme;

	return (
		<div
			className={`overflow-hidden rounded-lg border ${TRANSITION_CLASS}`}
			style={{ borderColor: ui.border, backgroundColor: ui.background }}
		>
			<div className="flex h-28">
				<div
					className={`flex w-9 shrink-0 flex-col items-center gap-2 border-r py-2.5 ${TRANSITION_CLASS}`}
					style={{
						backgroundColor: ui.sidebar,
						borderColor: ui.sidebarBorder,
					}}
				>
					<span
						className={`size-2.5 rounded-full ${TRANSITION_CLASS}`}
						style={{ backgroundColor: ui.sidebarPrimary }}
					/>
					<span
						className={`size-1.5 rounded-full opacity-50 ${TRANSITION_CLASS}`}
						style={{ backgroundColor: ui.mutedForeground }}
					/>
					<span
						className={`size-1.5 rounded-full opacity-50 ${TRANSITION_CLASS}`}
						style={{ backgroundColor: ui.mutedForeground }}
					/>
				</div>
				<div className="flex flex-1 flex-col gap-2 p-3">
					<div
						className={`h-2 w-2/3 rounded-full opacity-90 ${TRANSITION_CLASS}`}
						style={{ backgroundColor: ui.foreground }}
					/>
					<div
						className={`h-1.5 w-full rounded-full opacity-40 ${TRANSITION_CLASS}`}
						style={{ backgroundColor: ui.mutedForeground }}
					/>
					<div
						className={`h-1.5 w-4/5 rounded-full opacity-40 ${TRANSITION_CLASS}`}
						style={{ backgroundColor: ui.mutedForeground }}
					/>
					<div className="mt-auto flex items-center gap-1.5">
						<span
							className={`rounded-md px-2.5 py-1 text-[9px] font-medium ${TRANSITION_CLASS}`}
							style={{
								backgroundColor: ui.primary,
								color: ui.primaryForeground,
							}}
						>
							Button
						</span>
						<span
							className={`rounded-md border px-2.5 py-1 text-[9px] font-medium ${TRANSITION_CLASS}`}
							style={{
								borderColor: ui.border,
								backgroundColor: ui.secondary,
								color: ui.secondaryForeground,
							}}
						>
							Secondary
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
