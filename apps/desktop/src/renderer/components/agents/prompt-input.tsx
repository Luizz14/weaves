"use client";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
// beui.dev/components/agents/chat-app

import { ArrowUp, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type TextareaHTMLAttributes,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "renderer/components/motion/button";
import {
	MorphPopover,
	MorphPopoverContent,
	MorphPopoverTrigger,
} from "renderer/components/motion/popover-morph";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "renderer/components/motion/select";
import { cn } from "renderer/lib/utils";

export interface PromptModel {
	value: string;
	label: ReactNode;
	icon?: ReactNode;
	disabled?: boolean;
}

export interface PromptAction {
	value: string;
	label: ReactNode;
	description?: ReactNode;
	icon?: ReactNode;
	shortcut?: ReactNode;
	disabled?: boolean;
}

export interface PromptInputProps
	extends Omit<
		TextareaHTMLAttributes<HTMLTextAreaElement>,
		"value" | "defaultValue" | "onChange" | "onSubmit" | "children"
	> {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	models?: PromptModel[];
	model?: string;
	defaultModel?: string;
	onModelChange?: (model: string) => void;
	actions?: PromptAction[];
	onAction?: (action: string) => void;
	onSubmit?: (value: string, model?: string) => void | Promise<void>;
	loading?: boolean;
	submitDisabled?: boolean;
	/** For composers where attachments alone are a valid message. */
	allowEmptySubmit?: boolean;
	onStop?: () => void;
	minRows?: number;
	maxRows?: number;
	leadingAction?: ReactNode;
	className?: string;
}

export function PromptInput({
	value,
	defaultValue = "",
	onValueChange,
	models = [],
	model,
	defaultModel,
	onModelChange,
	actions = [],
	onAction,
	onSubmit,
	loading = false,
	submitDisabled = false,
	allowEmptySubmit = false,
	onStop,
	minRows = 2,
	maxRows = 8,
	leadingAction,
	className,
	disabled,
	placeholder = i18n._(msg({ message: "Ask the agent to do something\u2026" })),
	"aria-label": ariaLabel = i18n._(msg({ message: "Prompt" })),
	onKeyDown,
	...textareaProps
}: PromptInputProps) {
	const reduce = useReducedMotion() ?? false;
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const measurementRef = useRef<HTMLDivElement>(null);
	const [internalValue, setInternalValue] = useState(defaultValue);
	const [internalModel, setInternalModel] = useState(
		defaultModel ?? models[0]?.value,
	);
	const [actionsOpen, setActionsOpen] = useState(false);
	const currentValue = value ?? internalValue;
	const currentModelValue = model ?? internalModel;
	const currentModel = models.find(
		(option) => option.value === currentModelValue,
	);
	const canSubmit =
		(allowEmptySubmit || Boolean(currentValue.trim())) &&
		!disabled &&
		!loading &&
		!submitDisabled;

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		const measurement = measurementRef.current;
		if (!textarea || !measurement || textarea.value !== currentValue) return;

		const lineHeight = 24;
		const nextHeight = Math.min(
			Math.max(measurement.scrollHeight, minRows * lineHeight),
			maxRows * lineHeight,
		);
		const height = `${nextHeight}px`;
		if (textarea.style.height !== height) textarea.style.height = height;
	}, [currentValue, maxRows, minRows]);

	useLayoutEffect(() => {
		resizeTextarea();
	}, [resizeTextarea]);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(resizeTextarea);
		observer.observe(textarea);
		return () => observer.disconnect();
	}, [resizeTextarea]);

	const setValue = (next: string) => {
		if (value === undefined) setInternalValue(next);
		onValueChange?.(next);
	};

	const setModel = (next: string) => {
		if (model === undefined) setInternalModel(next);
		onModelChange?.(next);
	};

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		const prompt = currentValue.trim();
		if (!prompt || disabled || loading || submitDisabled) return;

		onSubmit?.(prompt, currentModelValue);
		if (value === undefined) setInternalValue("");
		textareaRef.current?.focus({ preventScroll: true });
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		onKeyDown?.(event);
		if (
			event.defaultPrevented ||
			event.key !== "Enter" ||
			event.shiftKey ||
			event.nativeEvent.isComposing
		) {
			return;
		}
		event.preventDefault();
		submit();
	};

	return (
		<form
			onSubmit={submit}
			className={cn(
				"outline-[2px] outline-border/40 -outline-offset-3 relative w-full rounded-2xl bg-background p-2 transition-colors",
				disabled && "opacity-60",
				className,
			)}
		>
			<div
				ref={measurementRef}
				aria-hidden="true"
				className="pointer-events-none invisible absolute inset-x-2 top-0 whitespace-pre-wrap px-2 text-sm leading-6 [overflow-wrap:break-word]"
			>
				{`${currentValue}\u200b`}
			</div>
			<textarea
				ref={textareaRef}
				value={currentValue}
				disabled={disabled}
				placeholder={placeholder}
				aria-label={ariaLabel}
				rows={minRows}
				{...textareaProps}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={handleKeyDown}
				className="scrollbar-hide block w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/55"
			/>

			<div className="mt-1 flex min-h-8 items-center gap-1">
				{actions.length ? (
					<div className="order-last ml-auto flex h-10 shrink-0 items-center gap-1">
						<MorphPopover open={actionsOpen} onOpenChange={setActionsOpen}>
							<MorphPopoverTrigger>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={disabled || loading}
									aria-label={i18n._(msg({ message: "Add" }))}
									className="size-10 rounded-full"
								>
									<motion.span
										aria-hidden="true"
										animate={{ rotate: actionsOpen ? 45 : 0 }}
										transition={
											reduce
												? { duration: 0 }
												: { type: "spring", duration: 0.3, bounce: 0 }
										}
									>
										<Plus className="size-4" />
									</motion.span>
								</Button>
							</MorphPopoverTrigger>

							<MorphPopoverContent
								side="top"
								align="start"
								sideOffset={8}
								radius={12}
								className="w-56 p-1.5"
							>
								{actions.map((action) => (
									<button
										key={action.value}
										type="button"
										disabled={action.disabled}
										onClick={() => {
											onAction?.(action.value);
											setActionsOpen(false);
										}}
										className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-[background-color,color,scale] hover:bg-muted focus-visible:bg-muted active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100"
									>
										{action.icon ? (
											<span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
												{action.icon}
											</span>
										) : null}
										<span className="min-w-0 flex-1">
											<span className="block text-sm text-foreground">
												{action.label}
											</span>
											{action.description ? (
												<span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
													{action.description}
												</span>
											) : null}
										</span>
										{action.shortcut ? (
											<span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground/70">
												{action.shortcut}
											</span>
										) : null}
									</button>
								))}
							</MorphPopoverContent>
						</MorphPopover>
					</div>
				) : null}
				{leadingAction}
				{models.length ? (
					<Select
						value={currentModelValue}
						onValueChange={setModel}
						disabled={disabled || loading}
						className="min-w-0"
					>
						<SelectTrigger className="h-8 w-auto max-w-52 rounded-xl border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted focus-visible:ring-2">
							<span className="flex min-w-0 items-center gap-1.5">
								{currentModel?.icon ? (
									<span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">
										{currentModel.icon}
									</span>
								) : null}
								<span className="truncate text-muted-foreground">
									{currentModel?.label ?? "Choose model"}
								</span>
							</span>
						</SelectTrigger>
						<SelectContent className="right-auto w-52 shadow-none">
							{models.map((option) => (
								<SelectItem
									key={option.value}
									value={option.value}
									disabled={option.disabled}
									className="py-2"
								>
									<span className="flex min-w-0 items-center gap-2">
										{option.icon ? (
											<span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
												{option.icon}
											</span>
										) : null}
										<span className="min-w-0 truncate text-sm text-foreground">
											{option.label}
										</span>
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}

				<Button
					type={loading ? "button" : "submit"}
					size="icon"
					disabled={loading ? !onStop : !canSubmit}
					aria-label={
						loading
							? i18n._(msg({ message: "Stop" }))
							: i18n._(msg({ message: "Send" }))
					}
					onClick={loading ? onStop : undefined}
					className="order-last size-10 rounded-full"
					pressScale={0.96}
				>
					<AnimatePresence initial={false} mode="popLayout">
						<motion.span
							key={loading ? "stop" : "send"}
							initial={
								reduce
									? { opacity: 1 }
									: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
							}
							animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
							exit={
								reduce
									? { opacity: 0 }
									: { opacity: 0, scale: 0.25, filter: "blur(4px)" }
							}
							transition={
								reduce
									? { duration: 0 }
									: { type: "spring", duration: 0.3, bounce: 0 }
							}
							className="grid place-items-center"
						>
							{loading ? (
								<Square className="size-3 fill-current" />
							) : (
								<ArrowUp className="size-4" />
							)}
						</motion.span>
					</AnimatePresence>
				</Button>
			</div>
		</form>
	);
}
