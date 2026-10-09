import { LSPPlugin } from "@codemirror/lsp-client";
import { StateEffect, type Text } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import type { EditorSettings } from "@superset/shared/editor-settings";
import type {
	InlayHint,
	InlayHintParams,
} from "vscode-languageserver-protocol";

const hintsReady = StateEffect.define<DecorationSet>();
const CACHED_DOCUMENTS = 50;
const MIN_DELAY_MS = 25;
const MAX_DELAY_MS = 625;
const RECENT_DURATIONS = 6;
const cachedHints = new Map<
	string,
	{ doc: Text; decorations: DecorationSet }
>();

function rememberHints(uri: string, doc: Text, decorations: DecorationSet) {
	cachedHints.delete(uri);
	cachedHints.set(uri, { doc, decorations });
	if (cachedHints.size <= CACHED_DOCUMENTS) return;
	const oldest = cachedHints.keys().next().value;
	if (oldest !== undefined) cachedHints.delete(oldest);
}
export const refreshHints = StateEffect.define<null>();
class HintWidget extends WidgetType {
	constructor(
		private label: string,
		private paddingLeft: boolean,
		private paddingRight: boolean,
	) {
		super();
	}
	eq(other: HintWidget) {
		return (
			this.label === other.label &&
			this.paddingLeft === other.paddingLeft &&
			this.paddingRight === other.paddingRight
		);
	}
	toDOM() {
		const span = document.createElement("span");
		span.className = "cm-editor-inlay-hint";
		span.textContent = this.label;
		span.style.paddingLeft = this.paddingLeft ? "0.4em" : "0";
		span.style.paddingRight = this.paddingRight ? "0.4em" : "0";
		return span;
	}
}

export function inlayHints(options: EditorSettings["hints"], uri: string) {
	if (
		!options.enabled ||
		!(options.types || options.parameters || options.other)
	)
		return [];
	return [
		ViewPlugin.fromClass(
			class {
				decorations = Decoration.none;
				private timer: ReturnType<typeof setTimeout> | null = null;
				private pending: InlayHintParams | null = null;
				private request = 0;
				private destroyed = false;
				private durations: number[] = [];
				constructor(private view: EditorView) {
					const cached = cachedHints.get(uri);
					if (cached?.doc.eq(view.state.doc))
						this.decorations = cached.decorations;
					this.schedule(0);
				}
				private delay() {
					if (!this.durations.length) return MIN_DELAY_MS * 1.5;
					const average =
						this.durations.reduce((total, value) => total + value, 0) /
						this.durations.length;
					return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, average));
				}
				update(update: ViewUpdate) {
					if (
						update.transactions.some((transaction) =>
							transaction.effects.some((effect) => effect.is(refreshHints)),
						)
					)
						this.schedule();
					for (const transaction of update.transactions)
						for (const effect of transaction.effects)
							if (effect.is(hintsReady)) this.decorations = effect.value;
					if (update.docChanged) {
						this.decorations = Decoration.none;
						this.schedule();
					} else if (update.viewportChanged) this.schedule();
				}
				private schedule(delay = this.delay()) {
					this.request++;
					if (this.pending) {
						LSPPlugin.get(this.view)?.client.cancelRequest(this.pending);
						this.pending = null;
					}
					if (this.timer) clearTimeout(this.timer);
					this.timer = setTimeout(() => {
						this.timer = null;
						void this.fetch();
					}, delay);
				}
				private async fetch() {
					const plugin = LSPPlugin.get(this.view);
					if (
						!plugin?.client.serverCapabilities?.inlayHintProvider ||
						this.destroyed
					)
						return;
					if (this.pending) plugin.client.cancelRequest(this.pending);
					plugin.client.sync();
					const document = this.view.state.doc;
					const request = ++this.request;
					const params: InlayHintParams = {
						textDocument: { uri: plugin.uri },
						range: {
							start: plugin.toPosition(this.view.viewport.from),
							end: plugin.toPosition(this.view.viewport.to),
						},
					};
					this.pending = params;
					const startedAt = performance.now();
					try {
						const hints = await plugin.client.request<
							InlayHintParams,
							InlayHint[] | null
						>("textDocument/inlayHint", params);
						if (
							this.destroyed ||
							request !== this.request ||
							this.view.state.doc !== document
						)
							return;
						this.durations.push(performance.now() - startedAt);
						if (this.durations.length > RECENT_DURATIONS)
							this.durations.shift();
						const decorations = (hints ?? [])
							.filter((hint) =>
								hint.kind === 1
									? options.types
									: hint.kind === 2
										? options.parameters
										: options.other,
							)
							.map((hint) =>
								Decoration.widget({
									widget: new HintWidget(
										typeof hint.label === "string"
											? hint.label
											: hint.label.map((part) => part.value).join(""),
										!!hint.paddingLeft,
										!!hint.paddingRight,
									),
									side: 1,
								}).range(plugin.fromPosition(hint.position)),
							);
						this.view.dispatch({
							effects: hintsReady.of(Decoration.set(decorations, true)),
						});
					} catch (error) {
						if (!this.destroyed && request === this.request)
							console.error("[editor] Inlay hints failed", error);
					} finally {
						if (this.pending === params) this.pending = null;
					}
				}
				destroy() {
					this.destroyed = true;
					rememberHints(uri, this.view.state.doc, this.decorations);
					this.request++;
					if (this.timer) clearTimeout(this.timer);
					const plugin = LSPPlugin.get(this.view);
					if (this.pending) plugin?.client.cancelRequest(this.pending);
				}
			},
			{ decorations: (plugin) => plugin.decorations },
		),
		EditorView.theme({
			".cm-editor-inlay-hint": {
				color: "inherit",
				opacity: "0.5",
				fontSize: "0.85em",
				userSelect: "none",
			},
		}),
	];
}
