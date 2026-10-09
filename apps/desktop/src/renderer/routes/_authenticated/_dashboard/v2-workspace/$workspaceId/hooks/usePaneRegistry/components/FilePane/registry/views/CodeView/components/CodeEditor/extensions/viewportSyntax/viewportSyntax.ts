import {
	forceParsing,
	language,
	syntaxTreeAvailable,
} from "@codemirror/language";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const TOTAL_BUDGET_MS = 150;
const SLICE_MS = 50;

// A new state is parsed only up to 3,000 characters; the rest of the viewport
// waits for an idle callback (>= 100 ms), so it would paint uncolored first.
export const viewportSyntax = ViewPlugin.fromClass(
	class {
		private spentMs = 0;
		private queued = false;
		private destroyed = false;

		constructor(private view: EditorView) {
			this.schedule();
		}

		update(update: ViewUpdate) {
			if (
				update.viewportChanged ||
				update.docChanged ||
				update.startState.facet(language) !== update.state.facet(language)
			)
				this.schedule();
		}

		private schedule() {
			if (this.queued || this.spentMs >= TOTAL_BUDGET_MS) return;
			this.queued = true;
			queueMicrotask(() => {
				this.queued = false;
				const { view } = this;
				if (
					this.destroyed ||
					!view.state.facet(language) ||
					syntaxTreeAvailable(view.state, view.viewport.to)
				)
					return;
				const startedAt = performance.now();
				forceParsing(
					view,
					view.viewport.to,
					Math.min(SLICE_MS, TOTAL_BUDGET_MS - this.spentMs),
				);
				this.spentMs += performance.now() - startedAt;
			});
		}

		destroy() {
			this.destroyed = true;
		}
	},
);
