import { Bot, Earth, MoonStar, Sparkles, Sun } from "lucide-react";
export function ModelIcon({
	modelId,
	className = "size-4",
}: {
	modelId: string;
	className?: string;
}) {
	const icon = modelId.endsWith("luna")
		? MoonStar
		: modelId.endsWith("terra")
			? Earth
			: modelId.endsWith("sol")
				? Sun
				: modelId.endsWith("astra")
					? Sparkles
					: Bot;
	const Icon = icon;
	const color = modelId.endsWith("luna")
		? "text-violet-400"
		: modelId.endsWith("terra")
			? "text-sky-500"
			: modelId.endsWith("sol")
				? "text-amber-500"
				: "text-rose-400";
	return <Icon className={`${className} ${color}`} aria-hidden="true" />;
}
