import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import {
	invokeNative,
	type NativeWebContents,
	onNativeEventNamed,
} from "main/native/platform";

type ContextMenuParams = {
	isEditable?: boolean;
	dictionarySuggestions?: string[];
	misspelledWord?: string;
	editFlags?: Partial<{
		canUndo: boolean;
		canRedo: boolean;
		canCut: boolean;
		canCopy: boolean;
		canPaste: boolean;
		canSelectAll: boolean;
	}>;
};

type ContextAction = { command: string; value?: string };
const contextActions = new Map<string, ContextAction>();
let nextContextActionId = 0;

function addContextAction(action: ContextAction): string {
	const id = `context-action-${++nextContextActionId}`;
	contextActions.set(id, action);
	return id;
}

onNativeEventNamed("menu:contextAction", (event) => {
	const payload =
		typeof event.payload === "object" && event.payload !== null
			? (event.payload as { action?: unknown })
			: {};
	if (typeof payload.action !== "string") return;
	const action = contextActions.get(payload.action);
	if (!action || !event.windowLabel) return;
	void invokeNative(
		action.command,
		{ value: action.value },
		30_000,
		event.windowLabel,
	);
	contextActions.delete(payload.action);
});

/**
 * Native CEF does not expose Electron's synchronous Menu object. We send the
 * same edit menu model to Rust and retain each selected action as a command so
 * spelling corrections and standard edit roles remain functional.
 */
export function attachEditContextMenu(wc: NativeWebContents): void {
	wc.on("context-menu", (rawParams) => {
		const params = (rawParams as ContextMenuParams | undefined) ?? {};
		if (!params.isEditable) return;

		const items: Array<Record<string, unknown>> = [];
		for (const suggestion of params.dictionarySuggestions ?? []) {
			items.push({
				label: suggestion,
				action: addContextAction({
					command: "window.replaceMisspelling",
					value: suggestion,
				}),
			});
		}
		if (params.misspelledWord) {
			items.push(
				{
					label: i18n._(msg({ message: "Add to Dictionary" })),
					action: addContextAction({
						command: "spell.addWord",
						value: params.misspelledWord,
					}),
				},
				{ type: "separator" },
			);
		}

		const flags = params.editFlags ?? {};
		items.push(
			{ role: "undo", enabled: flags.canUndo },
			{ role: "redo", enabled: flags.canRedo },
			{ type: "separator" },
			{ role: "cut", enabled: flags.canCut },
			{ role: "copy", enabled: flags.canCopy },
			{ role: "paste", enabled: flags.canPaste },
			{ type: "separator" },
			{ role: "selectAll", enabled: flags.canSelectAll },
		);
		void invokeNative(
			"menu.popupContext",
			{ items },
			30_000,
			wc.ownerLabel,
		);
	});
}
