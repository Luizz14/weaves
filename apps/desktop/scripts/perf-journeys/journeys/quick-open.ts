import { insertText, pressChord } from "../lib/input";
import { sleep, waitFor } from "../lib/system";
import {
	type BenchContext,
	closeAddedTabs,
	phaseFor,
	tabCount,
	workspaceScope,
} from "./context";

export const QUICK_OPEN_FILES = [
	"apps/desktop/src/main/index.ts",
	"apps/desktop/src/renderer/hotkeys/registry.ts",
	"apps/desktop/src/renderer/lib/terminal/terminal-ws-transport.ts",
	"packages/host-service/src/trpc/router/workspaces/workspaces.ts",
	"apps/desktop/src/shared/constants.ts",
	"packages/i18n/src/locales.ts",
	"apps/desktop/src/renderer/routes/_authenticated/layout.tsx",
	"packages/shared/src/constants.ts",
	"apps/desktop/electron.vite.config.ts",
	"apps/desktop/src/renderer/components/agents/message.tsx",
];

export async function runQuickOpen(ctx: BenchContext): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const scope = workspaceScope(perfBench.id);
	const baseline = await tabCount(session, perfBench.id);
	const warmups = ctx.warmups(3);
	const total = warmups + ctx.count(30);
	for (let i = 0; i < total; i++) {
		const file = QUICK_OPEN_FILES[i % QUICK_OPEN_FILES.length] as string;
		const phase = phaseFor(i, warmups);
		const palette = await session.sample(
			"quick-open-palette",
			"open",
			phase,
			{
				start: { type: "keydown", code: "KeyP", meta: true },
				end: { kind: "selector", selector: "[cmdk-input]", isNew: true },
				timeoutMs: 5_000,
			},
			() => pressChord(session.cdp, "meta+p"),
		);
		if (palette.record.status !== "ok") {
			await session.recover();
			continue;
		}
		await insertText(session.cdp, file);
		const item = `[cmdk-item][data-value$=${JSON.stringify(`/${file}`)}]`;
		const found = await waitFor(
			() =>
				session.eval<boolean>(`(() => {
					const el = document.querySelector('${item}');
					if (!el) return false;
					el.scrollIntoView({ block: "nearest" });
					return true;
				})()`),
			{ timeoutMs: 8_000, intervalMs: 50, label: "quick open result" },
		).catch(() => false);
		if (!found) {
			const count = await session.eval<number>(
				`document.querySelectorAll("[cmdk-item]").length`,
			);
			ctx.log(
				`  quick-open: fixture #${i % QUICK_OPEN_FILES.length} not found in ${count} results`,
			);
			await session.closeDialogs();
			continue;
		}
		await sleep(150);
		const opened = await session.sample(
			"quick-open-file",
			"code-editor",
			phase,
			{
				start: { type: "pointerdown" },
				end: { kind: "newDocument", within: scope },
				timeoutMs: 15_000,
			},
			async () => {
				if (!(await session.clickSelector(item))) {
					throw new Error("quick open result not clickable");
				}
			},
			{ maxAttempts: 1, allowDialog: true },
		);
		if (opened.record.status === "timeout") {
			const state = await session.eval<Record<string, unknown>>(`(() => {
				const root = document.querySelector('${scope}');
				return {
					documentsInScope: root ? root.querySelectorAll("[data-editor-document-id]").length : -1,
					documentsTotal: document.querySelectorAll("[data-editor-document-id]").length,
					tabs: root ? root.querySelectorAll("[data-tab-id]").length : -1,
					dialogs: document.querySelectorAll('[role="dialog"]').length,
					focus: document.activeElement?.tagName ?? null,
					routeIsWorkspace: location.hash.startsWith("#/v2-workspace/"),
				};
			})()`);
			ctx.log(`  quick-open-file timeout: ${JSON.stringify(state)}`);
		}
		await session.closeDialogs();
		await sleep(300);
		await closeAddedTabs(session, perfBench.id, baseline);
		const editorStillOpen = await session.eval<boolean>(
			`(() => { const el = document.querySelector('${scope} .cm-editor'); return !!el && el.getClientRects().length > 0; })()`,
		);
		if (editorStillOpen) {
			await session.clickSelector(`${scope} .cm-editor .cm-content`);
			await session.closeActivePane();
		}
	}
}
