import { cn } from "@superset/ui/utils";
import { type MouseEvent, type ReactNode, useRef, useState } from "react";

interface CardFoilEffectProps {
	children: ReactNode;
	className?: string;
	glowColor?: string;
}

export function CardFoilEffect({
	children,
	className,
	glowColor = "rgba(239, 68, 68, 0.3)",
}: CardFoilEffectProps) {
	const cardRef = useRef<HTMLDivElement>(null);
	const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
	const [glare, setGlare] = useState<{ x: number; y: number; opacity: number }>(
		{
			x: 50,
			y: 50,
			opacity: 0,
		},
	);
	const [isHovered, setIsHovered] = useState(false);

	const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
		if (!cardRef.current) return;
		const rect = cardRef.current.getBoundingClientRect();
		const width = rect.width;
		const height = rect.height;

		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const px = x / width;
		const py = y / height;

		// 3D Tilt angles (max +/- 10 degrees)
		const rx = (py - 0.5) * -14;
		const ry = (px - 0.5) * 14;

		setTilt({ rx, ry });
		setGlare({
			x: px * 100,
			y: py * 100,
			opacity: 0.6,
		});
		setIsHovered(true);
	};

	const handleMouseLeave = () => {
		setTilt({ rx: 0, ry: 0 });
		setGlare((prev) => ({ ...prev, opacity: 0 }));
		setIsHovered(false);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Visual presentation 3D tilt container
		<div
			ref={cardRef}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			className={cn(
				"relative rounded-xl overflow-hidden will-change-transform",
				className,
			)}
			style={{
				perspective: "1000px",
				transform: isHovered
					? `perspective(1000px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`
					: "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
				transition: isHovered
					? "transform 0.1s ease-out"
					: "transform 0.5s ease-out, box-shadow 0.5s ease-out",
				boxShadow: isHovered
					? `0 14px 28px rgba(0,0,0,0.4), 0 0 24px ${glowColor}`
					: "0 2px 8px rgba(0,0,0,0.15)",
			}}
		>
			{children}

			{/* Holographic foil shimmer layer */}
			<div
				className="pointer-events-none absolute inset-0 rounded-xl mix-blend-color-dodge transition-opacity duration-300"
				style={{
					opacity: glare.opacity,
					background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255, 255, 255, 0.45) 0%, rgba(255, 120, 200, 0.25) 35%, rgba(60, 220, 255, 0.3) 65%, transparent 80%)`,
				}}
			/>
		</div>
	);
}
