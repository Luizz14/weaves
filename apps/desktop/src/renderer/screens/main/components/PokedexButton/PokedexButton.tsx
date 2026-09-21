import { Button } from "@superset/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { HiOutlineShieldCheck } from "react-icons/hi2";

interface PokedexButtonProps {
	side?: ComponentProps<typeof TooltipContent>["side"];
	className?: string;
	iconClassName?: string;
	iconStrokeWidth?: number;
}

export function PokedexButton({
	side = "top",
	className,
	iconClassName,
}: PokedexButtonProps) {
	const navigate = useNavigate();

	return (
		<Tooltip delayDuration={600}>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => navigate({ to: "/settings/pokedex" })}
					aria-label="Abrir Pokédex de Ordem Paranormal"
					className={cn("no-drag", className)}
				>
					<HiOutlineShieldCheck
						className={cn(
							"size-5 text-muted-foreground hover:text-foreground transition-colors",
							iconClassName,
						)}
					/>
				</Button>
			</TooltipTrigger>
			<TooltipContent side={side}>Arquivo Paranormal (Pokédex)</TooltipContent>
		</Tooltip>
	);
}
