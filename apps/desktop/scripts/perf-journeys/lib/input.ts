import type { Cdp } from "./cdp";

const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;
export type Modifier = keyof typeof MODIFIER_BITS;

const MODIFIER_KEYS: Record<
	Modifier,
	{ key: string; code: string; keyCode: number }
> = {
	alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
	ctrl: { key: "Control", code: "ControlLeft", keyCode: 17 },
	meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
	shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};

const NAMED_KEYS: Record<
	string,
	{ key: string; code: string; keyCode: number; text?: string }
> = {
	enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
	backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
	escape: { key: "Escape", code: "Escape", keyCode: 27 },
	up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
	down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
	left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
	right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
	tab: { key: "Tab", code: "Tab", keyCode: 9 },
};

const MAC_EDITING_COMMANDS: Record<string, string> = {
	"meta+a": "selectAll",
	backspace: "deleteBackward",
};

export interface KeySpec {
	key: string;
	code: string;
	keyCode: number;
	text?: string;
	modifiers: Modifier[];
}

export function parseChord(chord: string): KeySpec {
	const parts = chord.toLowerCase().split("+");
	const last = parts.pop();
	if (!last) throw new Error(`empty chord: ${chord}`);
	const modifiers = parts.map((part) => {
		if (!(part in MODIFIER_BITS)) throw new Error(`unknown modifier ${part}`);
		return part as Modifier;
	});
	const named = NAMED_KEYS[last];
	if (named) {
		const textAllowed = modifiers.every((m) => m === "shift");
		return {
			...named,
			text: textAllowed ? named.text : undefined,
			modifiers,
		};
	}
	if (/^[a-z]$/.test(last)) {
		const upper = last.toUpperCase();
		return {
			key: modifiers.includes("shift") ? upper : last,
			code: `Key${upper}`,
			keyCode: upper.charCodeAt(0),
			text: modifiers.some((m) => m !== "shift") ? undefined : last,
			modifiers,
		};
	}
	throw new Error(`unsupported key in chord: ${chord}`);
}

export function isEnterChord(spec: KeySpec): boolean {
	return spec.key === "Enter";
}

export type EnterContext = "cmdk-input" | "new-workspace" | { shellIn: string };

function enterContextCheck(context: EnterContext): string {
	if (context === "cmdk-input") {
		return `document.activeElement?.matches?.("[cmdk-input]") === true`;
	}
	if (context === "new-workspace") {
		return `location.hash.startsWith("#/new-workspace") && !document.activeElement?.closest?.(".xterm, [role=application]") && !document.activeElement?.matches?.("textarea[aria-label]")`;
	}
	return `document.activeElement?.classList?.contains("xterm-helper-textarea") === true && !!document.activeElement.closest(${JSON.stringify(context.shellIn)})`;
}

export class EnterRefusedError extends Error {}

export async function typeInShell(
	cdp: Cdp,
	word: "claude",
	shellIn: string,
): Promise<void> {
	if (!(await cdp.eval<boolean>(enterContextCheck({ shellIn })))) {
		throw new EnterRefusedError("focus is not in the expected shell");
	}
	for (const character of word) await typeCharacter(cdp, character);
}

export async function pressChord(
	cdp: Cdp,
	chord: string,
	options: { allowEnterIn?: EnterContext; editingCommand?: boolean } = {},
): Promise<void> {
	const spec = parseChord(chord);
	if (isEnterChord(spec)) {
		if (!options.allowEnterIn) {
			throw new EnterRefusedError(`Enter refused outside an allowed context`);
		}
		const allowed = await cdp.eval<boolean>(
			enterContextCheck(options.allowEnterIn),
		);
		if (!allowed) {
			throw new EnterRefusedError(
				`Enter refused: focus is not in ${JSON.stringify(options.allowEnterIn)}`,
			);
		}
	}
	let bits = 0;
	for (const modifier of spec.modifiers) {
		bits |= MODIFIER_BITS[modifier];
		const m = MODIFIER_KEYS[modifier];
		await cdp.send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			key: m.key,
			code: m.code,
			windowsVirtualKeyCode: m.keyCode,
			nativeVirtualKeyCode: m.keyCode,
			modifiers: bits,
		});
	}
	const command = options.editingCommand
		? MAC_EDITING_COMMANDS[chord.toLowerCase()]
		: undefined;
	await cdp.send("Input.dispatchKeyEvent", {
		type: spec.text ? "keyDown" : "rawKeyDown",
		key: spec.key,
		code: spec.code,
		windowsVirtualKeyCode: spec.keyCode,
		nativeVirtualKeyCode: spec.keyCode,
		modifiers: bits,
		...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}),
		...(command ? { commands: [command] } : {}),
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: spec.key,
		code: spec.code,
		windowsVirtualKeyCode: spec.keyCode,
		nativeVirtualKeyCode: spec.keyCode,
		modifiers: bits,
	});
	for (const modifier of [...spec.modifiers].reverse()) {
		bits &= ~MODIFIER_BITS[modifier];
		const m = MODIFIER_KEYS[modifier];
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: m.key,
			code: m.code,
			windowsVirtualKeyCode: m.keyCode,
			nativeVirtualKeyCode: m.keyCode,
			modifiers: bits,
		});
	}
}

export async function typeCharacter(
	cdp: Cdp,
	character: string,
): Promise<void> {
	if (!/^[a-z0-9]$/.test(character)) {
		throw new Error(`typeCharacter only accepts [a-z0-9], got ${character}`);
	}
	await pressChord(cdp, character);
}

export async function insertText(cdp: Cdp, text: string): Promise<void> {
	if (/[\r\n]/.test(text)) throw new EnterRefusedError("newline refused");
	await cdp.send("Input.insertText", { text });
}

export async function click(
	cdp: Cdp,
	x: number,
	y: number,
	modifiers: Modifier[] = [],
): Promise<void> {
	const bits = modifiers.reduce((all, m) => all | MODIFIER_BITS[m], 0);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		modifiers: bits,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		buttons: 1,
		clickCount: 1,
		modifiers: bits,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		buttons: 0,
		clickCount: 1,
		modifiers: bits,
	});
}
