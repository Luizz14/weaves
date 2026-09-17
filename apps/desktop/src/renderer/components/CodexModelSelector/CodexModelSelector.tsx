import { Trans, useLingui } from "@lingui/react/macro";
import type { CodexExecution, CodexModel } from "@superset/chat/protocol";
import type { CodexModelPreset } from "@superset/shared/codex-chat-settings";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedModelIcon } from "./components/AnimatedModelIcon/AnimatedModelIcon";
import { AnimatedText } from "./components/AnimatedText/AnimatedText";
import { effortName, isPresetAvailable, modelName } from "./modelPresentation";

const LAYOUT_TRANSITION = {
	type: "spring" as const,
	duration: 0.3,
	bounce: 0,
};

function modelAccent(modelId: string): string {
	if (modelId.endsWith("luna")) return "bg-violet-400/55";
	if (modelId.endsWith("terra")) return "bg-sky-500/55";
	if (modelId.endsWith("sol")) return "bg-amber-500/55";
	return "bg-rose-400/55";
}

export function CodexModelSelector({
	value,
	presets,
	models,
	disabled,
	onChange,
}: {
	value: CodexExecution;
	presets: CodexModelPreset[];
	models: CodexModel[];
	disabled?: boolean;
	onChange: (preset: CodexModelPreset) => void;
}) {
	const { t } = useLingui();
	const reduce = useReducedMotion() ?? false;
	const selected = presets.findIndex(
		(preset) =>
			preset.modelId === value.modelId &&
			preset.reasoningEffort === value.reasoningEffort,
	);
	const available = presets.map((preset) => isPresetAvailable(preset, models));
	const label = `${modelName(value.modelId)} ${effortName(value.reasoningEffort, value.modelId)}`;
	const progress =
		selected < 0 || presets.length < 2 ? 0 : selected / (presets.length - 1);
	const sliderPosition = `calc(18px + ${progress} * (100% - 36px))`;
	function choose(index: number) {
		const preset = presets[index];
		if (!disabled && preset && available[index]) onChange(preset);
	}
	return (
		<Popover>
			<PopoverTrigger asChild>
				<motion.button
					layout={reduce ? false : "position"}
					transition={reduce ? { duration: 0 } : LAYOUT_TRANSITION}
					type="button"
					aria-disabled={disabled}
					onClick={(event) => {
						if (disabled) event.preventDefault();
					}}
					aria-label={t({ message: "Model and reasoning effort" })}
					className="inline-flex h-10 max-w-full items-center gap-2 rounded-full px-3 text-xs hover:shadow-[0_0_0_1px_var(--border)] outline-none transition-[scale,background-color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] aria-disabled:opacity-50 motion-reduce:active:scale-100"
				>
					<AnimatedModelIcon modelId={value.modelId} />
					<AnimatedText
						value={modelName(value.modelId)}
						className="truncate font-mono font-medium"
					/>
					<AnimatedText
						value={effortName(value.reasoningEffort, value.modelId)}
						className="truncate font-serif italic text-muted-foreground"
					/>
				</motion.button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="top"
				className="relative flex h-[112px] w-[min(390px,calc(100vw-24px))] flex-col items-center gap-3 rounded-[32px] border-none outline-[2px] outline-border/50 -outline-offset-3 bg-background px-[25px] py-[17px] shadow-[0_8px_32px_#1a1a1a14] "
			>
				<div className="flex h-[26px] items-center justify-center gap-2">
					<AnimatedModelIcon modelId={value.modelId} className="size-[26px]" />
					<AnimatedText
						value={modelName(value.modelId)}
						className="font-mono text-[22px] font-medium leading-[30px]"
					/>
					<AnimatedText
						value={effortName(value.reasoningEffort, value.modelId)}
						className="font-serif text-[22px] italic leading-[30px] text-muted-foreground"
					/>
				</div>
				{presets.length === 1 ? (
					<button
						type="button"
						disabled={disabled || !available[0]}
						onClick={() => choose(0)}
						className="min-h-10 w-full rounded-full bg-muted px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
					>
						{presets[0] &&
							`${modelName(presets[0].modelId)} ${effortName(presets[0].reasoningEffort, presets[0].modelId)}`}
					</button>
				) : (
					<div className="absolute inset-x-6 top-[66px] h-[26px]">
						<div className="relative h-[26px] rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
							<div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full bg-muted">
								<motion.div
									className={`h-full rounded-full ${modelAccent(value.modelId)}`}
									animate={{ width: sliderPosition }}
									transition={reduce ? { duration: 0 } : LAYOUT_TRANSITION}
								/>
							</div>
							<div className="pointer-events-none absolute inset-0 flex items-center justify-between px-[22px]">
								{presets.map((preset, index) => (
									<span
										key={preset.id}
										title={`${modelName(preset.modelId)} ${effortName(preset.reasoningEffort, preset.modelId)}`}
										className={`size-1.5 rounded-full ${available[index] ? "bg-foreground/10" : "bg-destructive/20"}`}
									/>
								))}
							</div>
							<motion.div
								aria-hidden="true"
								className="pointer-events-none absolute top-[-5px] size-9 -translate-x-1/2 rounded-full bg-foreground shadow-[0_4px_12px_#0002]"
								animate={{ left: sliderPosition }}
								transition={reduce ? { duration: 0 } : LAYOUT_TRANSITION}
							/>
							<input
								type="range"
								aria-label={t({ message: "Model and reasoning effort" })}
								aria-valuetext={
									selected >= 0
										? `${label}, ${selected + 1} / ${presets.length}`
										: label
								}
								min={0}
								max={Math.max(1, presets.length - 1)}
								step={1}
								value={Math.max(0, selected)}
								aria-disabled={disabled || !available.some(Boolean)}
								onChange={(event) => choose(Number(event.target.value))}
								onKeyDown={(event) => {
									if (
										![
											"ArrowLeft",
											"ArrowRight",
											"ArrowUp",
											"ArrowDown",
											"Home",
											"End",
										].includes(event.key)
									)
										return;
									event.preventDefault();
									const valid = presets
										.map((_, index) => index)
										.filter((index) => available[index]);
									const next =
										event.key === "Home"
											? valid[0]
											: event.key === "End"
												? valid.at(-1)
												: ["ArrowRight", "ArrowUp"].includes(event.key)
													? valid.find((index) => index > selected)
													: valid.findLast((index) => index < selected);
									if (next !== undefined) choose(next);
								}}
								className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 outline-none [&::-webkit-slider-thumb]:size-9 [&::-webkit-slider-thumb]:appearance-none"
							/>
						</div>
					</div>
				)}
				{!available.every(Boolean) && (
					<p className="sr-only">
						<Trans>Some presets are unavailable on this host.</Trans>
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
