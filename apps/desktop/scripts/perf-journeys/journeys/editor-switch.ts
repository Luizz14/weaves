import { insertText, pressChord } from "../lib/input";
import type { ArmSpec, Phase } from "../lib/session";
import { sleep, waitFor } from "../lib/system";
import { type BenchContext, phaseFor, workspaceScope } from "./context";

const FIRST_OPEN_FILES = [
	"apps/desktop/src/renderer/commandPalette/ui/CommandPalette/CommandPalette.tsx",
	"apps/desktop/src/renderer/components/MarkdownRenderer/components/TipTapMarkdownRenderer/serializeMarkdownTable.ts",
	"apps/desktop/src/renderer/components/agents/chat-app.tsx",
	"apps/desktop/src/renderer/hooks/host-workspaces/useHostWorkspaces/useHostWorkspaces.utils.ts",
	"apps/desktop/src/renderer/lib/terminal/links/local-link-detector.ts",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/automations/components/ProjectPicker/ProjectPicker.tsx",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/TopBarPortsDropdown/components/TopBarPortRow/TopBarPortRow.tsx",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspaces/stores/v2WorkspacesFilterStore/v2WorkspacesFilterStore.ts",
	"apps/desktop/src/renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/V2AgentsSettings.tsx",
	"apps/desktop/src/renderer/routes/_authenticated/settings/editor/components/CodeEditorSettings/fields.ts",
	"apps/desktop/src/renderer/routes/_authenticated/settings/terminal/components/TerminalSettings/components/PresetRow/PresetRow.tsx",
	"apps/desktop/src/renderer/screens/main/components/WorkspaceSidebar/WorkspaceListItem/WorkspaceContextMenu.tsx",
	"apps/desktop/src/renderer/screens/main/components/WorkspaceView/RightSidebar/ChangesView/components/FileList/FileListTreeVirtualized.tsx",
	"apps/desktop/src/renderer/stores/sidebar-state.ts",
	"packages/host-service/src/runtime/azure-devops/diagnostics.ts",
	"packages/host-service/src/terminal/terminal-mode-tracker.ts",
	"packages/host-service/src/trpc/router/ports/ports.ts",
	"packages/shared/src/agent-prompt-launch.ts",
	"packages/shared/src/sqlite-migrations/runMigrations.ts",
	"apps/desktop/src/lib/trpc/routers/changes/staging.ts",
	"apps/desktop/src/lib/trpc/routers/workspaces/utils/db-helpers.ts",
	"apps/desktop/src/main/lib/data-batcher.ts",
	"apps/desktop/src/main/lib/window-registry/window-registry.ts",
	"apps/desktop/src/renderer/components/Paywall/Paywall.tsx",
	"apps/desktop/src/renderer/components/agents/todo-list.tsx",
	"apps/desktop/src/renderer/hooks/useIsV2CloudEnabled.ts",
	"apps/desktop/src/renderer/lib/terminal/terminal-buffer-gc.ts",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/ResourceConsumption/ResourceConsumption.tsx",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/hooks/useHostReachability/useHostReachability.ts",
	"apps/desktop/src/renderer/routes/_authenticated/onboarding/layout.tsx",
	"apps/desktop/src/renderer/routes/_authenticated/settings/keyboard/page.tsx",
	"apps/desktop/src/renderer/screens/main/components/WorkspaceSidebar/WorkspaceSidebarFooter.tsx",
	"apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/hooks/useTextSearch/useTextSearch.ts",
	"apps/desktop/src/renderer/stores/ringtone/store.ts",
	"packages/host-service/src/providers/git/LocalGitCredentialProvider/LocalGitCredentialProvider.ts",
	"packages/host-service/src/terminal/clean-shell-env.ts",
	"packages/host-service/src/trpc/router/usage/history/fx.ts",
	"packages/host-service/src/trpc/router/workspace/workspace.ts",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/automations/components/RelayOfflineNotice/RelayOfflineNotice.tsx",
	"apps/desktop/src/renderer/components/DesktopNotices/components/NoticeDialog/NoticeDialog.tsx",
	"apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useBulkWorkspaceMoveActions/useBulkWorkspaceMoveActions.ts",
	"apps/desktop/src/renderer/screens/main/components/WorkspaceView/RightSidebar/ChangesView/components/FolderRow/FolderRow.tsx",
	"packages/host-service/src/trpc/router/git/utils/diff-side-blob.ts",
];
const REVISIT_FILES = [
	"packages/shared/src/editor-settings.ts",
	"packages/shared/src/lsp.ts",
];
const SCROLLED_FILES = [
	"apps/desktop/src/main/lib/host-service-coordinator.ts",
	"apps/desktop/src/renderer/routes/_authenticated/settings/automations/components/AutomationsPageContent/AutomationsPageContent.tsx",
];
const TAB_FILE = "packages/shared/src/host-version.ts";

const SETTLE_OBSERVE_MS = 2500;
let firstOpenCursor = 0;

interface EditorSwitchState {
	scope: string;
	readyText: string;
	loadingText: string;
	terminalTabId: string | null;
	fileTabId: string | null;
}

function settleSpec(
	state: EditorSwitchState,
	start: ArmSpec["start"],
): ArmSpec {
	return {
		start,
		end: {
			kind: "editorSettled",
			within: state.scope,
			observeMs: SETTLE_OBSERVE_MS,
			readyText: state.readyText,
			loadingText: state.loadingText,
		},
		timeoutMs: 20_000,
	};
}

async function documentIds(ctx: BenchContext, scope: string) {
	return ctx.session.eval<string[]>(
		`[...document.querySelectorAll(${JSON.stringify(`${scope} [data-editor-document-id]`)})].map((el) => el.getAttribute("data-editor-document-id"))`,
	);
}

async function openPaletteItem(
	ctx: BenchContext,
	file: string,
): Promise<string | null> {
	const { session } = ctx;
	await pressChord(session.cdp, "meta+p");
	const opened = await waitFor(
		() =>
			session.eval<boolean>(`(() => {
				const el = document.querySelector("[cmdk-input]");
				return !!el && el.getClientRects().length > 0;
			})()`),
		{ timeoutMs: 5_000, intervalMs: 50, label: "quick open" },
	).catch(() => false);
	if (!opened) return null;
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
		ctx.log(`  editor-switch: ${file} not found in quick open`);
		await session.closeDialogs();
		return null;
	}
	await sleep(150);
	return item;
}

async function openUnmeasured(
	ctx: BenchContext,
	state: EditorSwitchState,
	file: string,
): Promise<string | null> {
	const before = new Set(await documentIds(ctx, state.scope));
	const item = await openPaletteItem(ctx, file);
	if (!item) return null;
	if (!(await ctx.session.clickSelector(item))) {
		await ctx.session.closeDialogs();
		return null;
	}
	let opened: string | null = null;
	await waitFor(
		async () => {
			const ids = await documentIds(ctx, state.scope);
			opened = ids.find((id) => !before.has(id)) ?? null;
			return opened !== null;
		},
		{ timeoutMs: 15_000, intervalMs: 50, label: "editor for the opened file" },
	).catch(() => undefined);
	await ctx.session.closeDialogs();
	return opened;
}

async function measuredOpen(
	ctx: BenchContext,
	state: EditorSwitchState,
	variant: string,
	phase: Phase,
	file: string,
): Promise<void> {
	const { session } = ctx;
	const item = await openPaletteItem(ctx, file);
	if (!item) {
		await session.recover();
		return;
	}
	const outcome = await session.sample(
		"editor-switch",
		variant,
		phase,
		settleSpec(state, { type: "pointerdown" }),
		async () => {
			if (!(await session.clickSelector(item))) {
				throw new Error("quick open result not clickable");
			}
		},
		{ maxAttempts: 1, allowDialog: true },
	);
	if (outcome.record.status === "timeout") {
		ctx.log(`  editor-switch/${variant} timeout: ${file}`);
	}
	await session.closeDialogs();
}

async function scrollActiveEditorToMiddle(
	ctx: BenchContext,
	state: EditorSwitchState,
	documentId: string,
): Promise<void> {
	await ctx.session.eval(`(() => {
		const root = document.querySelector(${JSON.stringify(`${state.scope} [data-editor-document-id="${documentId}"]`)});
		const scroller = root?.querySelector(".cm-scroller");
		if (!scroller) return false;
		scroller.scrollTop = Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2);
		return true;
	})()`);
	await sleep(400);
}

async function waitForLanguageServer(
	ctx: BenchContext,
	state: EditorSwitchState,
): Promise<boolean> {
	return waitFor(
		() =>
			ctx.session.eval<boolean>(
				`[...document.querySelectorAll(${JSON.stringify(`${state.scope} [data-editor-document-id] output`)})].some((el) => (el.textContent ?? "").includes(${JSON.stringify(state.readyText)}))`,
			),
		{ timeoutMs: 120_000, intervalMs: 250, label: "language server ready" },
	).then(
		() => true,
		() => false,
	);
}

async function clickTab(
	ctx: BenchContext,
	state: EditorSwitchState,
	tabId: string,
): Promise<boolean> {
	return ctx.session.clickSelector(`[data-tab-id="${tabId}"]`, {
		within: state.scope,
	});
}

async function createFileTab(
	ctx: BenchContext,
	state: EditorSwitchState,
): Promise<void> {
	const { session } = ctx;
	if (!(await openUnmeasured(ctx, state, TAB_FILE))) return;
	await sleep(500);
	const tabs = await session.eval<Array<{ id: string; title: string }>>(
		`[...document.querySelectorAll(${JSON.stringify(`${state.scope} [data-tab-id]`)})].map((el) => ({ id: el.getAttribute("data-tab-id"), title: el.textContent ?? "" }))`,
	);
	const name = TAB_FILE.split("/").pop() as string;
	state.fileTabId = tabs.find((tab) => tab.title.includes(name))?.id ?? null;
	state.terminalTabId =
		tabs.find((tab) => tab.id !== state.fileTabId)?.id ?? null;
	if (!state.fileTabId || !state.terminalTabId) {
		ctx.log(
			`  editor-switch: tab switch needs the tab file's tab and another (${tabs.length} tabs)`,
		);
		state.fileTabId = null;
		return;
	}
	await clickTab(ctx, state, state.terminalTabId);
	await sleep(500);
}

async function measuredTabSwitch(
	ctx: BenchContext,
	state: EditorSwitchState,
	phase: Phase,
): Promise<void> {
	const { session } = ctx;
	const { fileTabId, terminalTabId } = state;
	if (!fileTabId || !terminalTabId) return;
	await session.sample(
		"editor-switch",
		"tab-switch",
		phase,
		settleSpec(state, { type: "pointerdown" }),
		async () => {
			if (!(await clickTab(ctx, state, fileTabId))) {
				throw new Error("file tab not clickable");
			}
		},
		{ maxAttempts: 1, allowDialog: true },
	);
	await clickTab(ctx, state, terminalTabId);
	await sleep(400);
}

async function closeFileTab(
	ctx: BenchContext,
	state: EditorSwitchState,
): Promise<void> {
	const { session } = ctx;
	if (state.fileTabId && (await clickTab(ctx, state, state.fileTabId))) {
		await sleep(300);
		await session.clickSelector(`${state.scope} .cm-editor .cm-content`);
		await session.closeActivePane();
	}
	if (state.terminalTabId) await clickTab(ctx, state, state.terminalTabId);
	await sleep(300);
	if (await session.clickSelector(`${state.scope} .cm-editor .cm-content`)) {
		await session.closeActivePane();
	}
}

export async function runEditorSwitch(ctx: BenchContext): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const state: EditorSwitchState = {
		scope: workspaceScope(perfBench.id),
		readyText: session.tr.t("Language server ready"),
		loadingText: session.tr.t("Loading…"),
		terminalTabId: null,
		fileTabId: null,
	};
	const warm = await openUnmeasured(ctx, state, REVISIT_FILES[0] as string);
	if (!warm || !(await waitForLanguageServer(ctx, state))) {
		ctx.log("  editor-switch: language server never became ready, skipping");
		await closeFileTab(ctx, state);
		return;
	}
	await sleep(3000);
	await openUnmeasured(ctx, state, REVISIT_FILES[1] as string);
	for (const file of SCROLLED_FILES) {
		const id = await openUnmeasured(ctx, state, file);
		if (id) await scrollActiveEditorToMiddle(ctx, state, id);
	}
	await createFileTab(ctx, state);
	const warmups = ctx.warmups(2);
	const total = warmups + ctx.count(30);
	for (let i = 0; i < total; i++) {
		const phase = phaseFor(i, warmups);
		const fresh = FIRST_OPEN_FILES[firstOpenCursor % FIRST_OPEN_FILES.length];
		firstOpenCursor++;
		await measuredOpen(ctx, state, "first", phase, fresh as string);
		await measuredOpen(
			ctx,
			state,
			"revisit",
			phase,
			REVISIT_FILES[i % REVISIT_FILES.length] as string,
		);
		await measuredOpen(
			ctx,
			state,
			"revisit-scrolled",
			phase,
			SCROLLED_FILES[i % SCROLLED_FILES.length] as string,
		);
		await measuredTabSwitch(ctx, state, phase);
	}
	await closeFileTab(ctx, state);
}
