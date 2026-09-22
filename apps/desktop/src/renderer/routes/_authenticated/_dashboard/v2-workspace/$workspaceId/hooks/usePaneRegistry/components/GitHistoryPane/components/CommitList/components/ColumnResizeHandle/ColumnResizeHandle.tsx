import { useRef } from "react";

export function ColumnResizeHandle({
	label,
	width,
	minWidth,
	onResize,
}: {
	label: string;
	width: number;
	minWidth: number;
	onResize: (width: number) => void;
}) {
	const drag = useRef<{ x: number; width: number } | null>(null);
	const resize = (value: number) =>
		onResize(Math.max(minWidth, Math.min(2400, value)));
	return (
		<hr
			tabIndex={0}
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={minWidth}
			aria-valuemax={2400}
			aria-valuenow={Math.round(width)}
			className="absolute right-0 top-0 z-20 m-0 h-full w-2 touch-none cursor-col-resize select-none border-0 border-r border-border/70 hover:bg-primary/25 focus-visible:bg-primary/25 focus-visible:outline-none"
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.focus();
				drag.current = {
					x: event.clientX,
					width:
						event.currentTarget.parentElement?.getBoundingClientRect().width ??
						width,
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				if (drag.current)
					resize(drag.current.width + event.clientX - drag.current.x);
			}}
			onPointerUp={(event) => {
				drag.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId))
					event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onLostPointerCapture={() => {
				drag.current = null;
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const current =
					event.currentTarget.parentElement?.getBoundingClientRect().width ??
					width;
				resize(current + (event.key === "ArrowRight" ? 24 : -24));
			}}
		/>
	);
}
