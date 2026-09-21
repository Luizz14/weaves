import type { OrdemDiscoveryEvent } from "@superset/shared/ordem-paranormal";
import { Button } from "@superset/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HiOutlineSparkles, HiXMark } from "react-icons/hi2";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { ElementBadge } from "../../settings/pokedex/components/ElementBadge";

const ELEMENT_THEMES: Record<
	string,
	{
		border: string;
		glow: string;
		gradient: string;
		accent: string;
		badge: string;
	}
> = {
	Sangue: {
		border: "border-red-500/70",
		glow: "shadow-[0_0_35px_rgba(239,68,68,0.4)]",
		gradient: "from-red-950/90 via-zinc-950 to-neutral-950",
		accent: "text-red-400",
		badge: "bg-red-500/20 text-red-300 border-red-500/40",
	},
	Morte: {
		border: "border-neutral-400/60",
		glow: "shadow-[0_0_35px_rgba(200,200,200,0.3)]",
		gradient: "from-neutral-900 via-zinc-950 to-black",
		accent: "text-neutral-300",
		badge: "bg-neutral-500/20 text-neutral-300 border-neutral-400/40",
	},
	Conhecimento: {
		border: "border-amber-400/70",
		glow: "shadow-[0_0_35px_rgba(245,158,11,0.4)]",
		gradient: "from-amber-950/90 via-zinc-950 to-neutral-950",
		accent: "text-amber-400",
		badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
	},
	Energia: {
		border: "border-purple-500/70",
		glow: "shadow-[0_0_35px_rgba(168,85,247,0.4)]",
		gradient: "from-purple-950/90 via-zinc-950 to-neutral-950",
		accent: "text-purple-400",
		badge: "bg-purple-500/20 text-purple-300 border-purple-500/40",
	},
	Medo: {
		border: "border-sky-400/70",
		glow: "shadow-[0_0_35px_rgba(56,189,248,0.4)]",
		gradient: "from-sky-950/90 via-zinc-950 to-neutral-950",
		accent: "text-sky-400",
		badge: "bg-sky-500/20 text-sky-300 border-sky-500/40",
	},
	Nenhum: {
		border: "border-zinc-500/60",
		glow: "shadow-[0_0_25px_rgba(161,161,170,0.3)]",
		gradient: "from-zinc-900 via-zinc-950 to-black",
		accent: "text-zinc-300",
		badge: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40",
	},
};

export function OrdemPokemonCardReveal() {
	const navigate = useNavigate();
	const [activeDiscovery, setActiveDiscovery] =
		useState<OrdemDiscoveryEvent | null>(null);
	const [imageError, setImageError] = useState(false);
	const [isVisible, setIsVisible] = useState(false);

	// Subscribe to realtime discoveries
	electronTrpc.ordemParanormal.onDiscovery.useSubscription(undefined, {
		onData: (discovery) => {
			setImageError(false);
			setActiveDiscovery(discovery);
			setIsVisible(true);
		},
	});

	// Auto dismiss timer (12 seconds)
	useEffect(() => {
		if (!isVisible) return;
		const timer = setTimeout(() => {
			setIsVisible(false);
		}, 12_000);
		return () => clearTimeout(timer);
	}, [isVisible]);

	if (!activeDiscovery || !isVisible) {
		return null;
	}

	const { character, isFirstDiscovery } = activeDiscovery;
	const theme = ELEMENT_THEMES[character.element] ?? ELEMENT_THEMES.Nenhum;

	const handleOpenPokedex = () => {
		setIsVisible(false);
		navigate({ to: "/settings/pokedex" });
	};

	return (
		<div className="fixed bottom-5 right-5 z-50 transition-all duration-500 ease-out animate-in fade-in slide-in-from-bottom-6">
			{/* Pokémon Card Frame */}
			<div
				className={`relative w-80 rounded-2xl p-3.5 bg-gradient-to-b ${theme.gradient} border-2 ${theme.border} ${theme.glow} shadow-2xl text-foreground select-none overflow-hidden group`}
				style={{
					transform: "rotate(-1deg)",
					transition: "transform 0.3s ease, box-shadow 0.3s ease",
				}}
			>
				{/* Holographic foil sweep layer */}
				<div
					className="absolute inset-0 pointer-events-none opacity-40 mix-blend-color-dodge transition-opacity group-hover:opacity-75"
					style={{
						background:
							"linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.4) 45%, rgba(255,100,200,0.3) 50%, rgba(100,220,255,0.4) 55%, transparent 75%)",
						backgroundSize: "200% 200%",
						animation: "holoShine 4s infinite linear",
					}}
				/>

				{/* Close Button */}
				<button
					type="button"
					onClick={() => setIsVisible(false)}
					className="absolute top-2.5 right-2.5 z-20 size-6 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
				>
					<HiXMark className="size-4" />
				</button>

				{/* Card Header Tag */}
				<div className="flex items-center justify-between mb-2 pr-6">
					<div className="flex items-center gap-1.5">
						<HiOutlineSparkles
							className={`size-3.5 ${theme.accent} animate-spin`}
							style={{ animationDuration: "6s" }}
						/>
						<span className="text-[10px] font-black uppercase tracking-wider text-amber-300">
							{isFirstDiscovery
								? "★ NOVA DESCOBERTA ★"
								: "ENTIDADE MANIFESTADA"}
						</span>
					</div>
					<span className="text-[10px] font-mono font-bold text-zinc-400">
						VD {character.vd ?? 100}
					</span>
				</div>

				{/* Card Title & Element Row */}
				<div className="flex items-center justify-between gap-2 mb-2 bg-black/40 px-2 py-1 rounded-md border border-white/10">
					<h4 className="font-extrabold text-sm tracking-tight text-white truncate">
						{character.name}
					</h4>
					<ElementBadge
						element={character.element}
						className="text-[10px] shrink-0"
					/>
				</div>

				{/* Card Illustration / Portrait (Foil Border) */}
				<div className="relative w-full h-44 rounded-lg overflow-hidden bg-black/60 border border-white/20 mb-2.5 shadow-inner">
					{!imageError ? (
						<img
							src={character.imageUrl}
							alt={character.name}
							onError={() => setImageError(true)}
							className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
						/>
					) : (
						<div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-1.5">
							<HiOutlineSparkles className={`size-10 ${theme.accent}`} />
							<span className="text-xs font-mono">{character.name}</span>
						</div>
					)}
					<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />

					{/* Category Stamp */}
					<div className="absolute bottom-1.5 left-2">
						<span className="text-[10px] font-bold uppercase tracking-wider text-white/90 bg-black/60 px-1.5 py-0.5 rounded border border-white/10">
							{character.category} • {character.season}
						</span>
					</div>
				</div>

				{/* Card Ability / Role Box */}
				<div className="bg-black/30 border border-white/10 rounded-lg p-2 mb-3 text-left">
					<div className="flex items-center justify-between text-[11px] mb-1">
						<span className="font-bold text-zinc-200">{character.role}</span>
						<span className="text-[9px] font-mono text-zinc-400 uppercase">
							Habilidade
						</span>
					</div>
					<p className="text-[11px] text-zinc-300 italic line-clamp-2 leading-relaxed">
						"{character.quote || character.description}"
					</p>
				</div>

				{/* Card Action Footer */}
				<div className="flex items-center gap-2 pt-1 border-t border-white/10">
					<Button
						variant="secondary"
						size="sm"
						onClick={handleOpenPokedex}
						className="flex-1 h-7 text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/20 shadow-sm"
					>
						Abrir no Arquivo 📜
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setIsVisible(false)}
						className="h-7 text-xs text-zinc-400 hover:text-white px-2"
					>
						Guardar
					</Button>
				</div>
			</div>
		</div>
	);
}
