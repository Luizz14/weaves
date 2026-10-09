import { appendFileSync } from "node:fs";
import { BENCH_APP } from "./app";
import type { Cdp } from "./cdp";
import type { Translator } from "./i18n";
import { click, insertText, pressChord } from "./input";
import { isScreenLocked, run, sleep, waitFor } from "./system";

export interface StartSpec {
	type: "keydown" | "pointerdown";
	code?: string;
	meta?: boolean;
	shift?: boolean;
}

export interface ArmSpec {
	start: StartSpec;
	end: { kind: string; [key: string]: unknown };
	timeoutMs?: number;
	jsonMarks?: string[];
}

export interface ProbeResult {
	status: "ok" | "timeout" | "invalid";
	reason: string | null;
	durationMs: number | null;
	marks: Record<string, number>;
	output: string | null;
	focusLost: boolean;
	loafCount: number;
	loafBlockingMs: number;
	diag?: string[] | null;
}

export type Phase = "warmup" | "measured";

export interface SampleRecord {
	journey: string;
	variant: string;
	phase: Phase;
	attempt: number;
	status: ProbeResult["status"];
	invalidReason: string | null;
	durationMs: number | null;
	marks: Record<string, number>;
	loafCount: number;
	loafBlockingMs: number;
	diag?: string[] | null;
	clock: "renderer-perf" | "system-monotonic";
	startSource: StartSpec["type"] | "spawn";
	elapsedRunMs: number;
}

export interface SampleOutcome {
	record: SampleRecord;
	output: string | null;
}

export class SampleSink {
	private readonly started = performance.now();
	readonly records: SampleRecord[] = [];

	constructor(private path: string) {}

	write(record: Omit<SampleRecord, "elapsedRunMs">): SampleRecord {
		const full = {
			...record,
			elapsedRunMs: Math.round(performance.now() - this.started),
		};
		this.records.push(full);
		appendFileSync(this.path, `${JSON.stringify(full)}\n`, { mode: 0o600 });
		return full;
	}
}

export class Session {
	private jitterIndex = 0;

	constructor(
		public cdp: Cdp,
		readonly tr: Translator,
		readonly sink: SampleSink,
		readonly log: (message: string) => void,
	) {}

	eval<T>(expression: string, timeoutMs?: number): Promise<T> {
		return this.cdp.eval<T>(expression, timeoutMs);
	}

	async currentWorkspaceId(): Promise<string | null> {
		const hash = await this.eval<string>("location.hash");
		return hash.match(/^#\/v2-workspace\/([^/?]+)/)?.[1] ?? null;
	}

	async dialogOpen(): Promise<boolean> {
		return this.eval<boolean>(`(() => {
			const el = document.querySelector('[role="dialog"], [role="alertdialog"]');
			return !!el && el.getClientRects().length > 0;
		})()`);
	}

	async ensureFocus(): Promise<boolean> {
		if (await this.eval<boolean>("document.hasFocus()")) return true;
		run(["open", "-a", BENCH_APP]);
		await sleep(500);
		return this.eval<boolean>("document.hasFocus()");
	}

	async elementCenter(
		selector: string,
		options: { textEquals?: string; within?: string } = {},
	): Promise<{ x: number; y: number } | null> {
		return this.eval(`(() => {
			const root = ${options.within ? `document.querySelector(${JSON.stringify(options.within)})` : "document"};
			if (!root) return null;
			const wanted = ${JSON.stringify(options.textEquals?.toLowerCase() ?? null)};
			for (const el of root.querySelectorAll(${JSON.stringify(selector)})) {
				if (wanted !== null && (el.textContent ?? "").trim().toLowerCase() !== wanted) continue;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) continue;
				const x = rect.left + rect.width / 2;
				const y = rect.top + rect.height / 2;
				const hit = document.elementFromPoint(x, y);
				if (hit && (hit === el || el.contains(hit))) return { x, y };
			}
			return null;
		})()`);
	}

	async clickSelector(
		selector: string,
		options: { textEquals?: string; within?: string } = {},
	): Promise<boolean> {
		const point = await this.elementCenter(selector, options);
		if (!point) return false;
		await click(this.cdp, point.x, point.y);
		return true;
	}

	async confirmTerminalCloseIfAsked(): Promise<void> {
		const label = this.tr.t("Close terminal");
		for (let i = 0; i < 15; i++) {
			await sleep(100);
			const clicked = await this.clickSelector(
				'[role="dialog"] button, [role="alertdialog"] button',
				{
					textEquals: label,
				},
			);
			if (clicked) return;
		}
	}

	async closeActivePane(): Promise<void> {
		await pressChord(this.cdp, "meta+w");
		await this.confirmTerminalCloseIfAsked();
		await sleep(300);
	}

	async revealSidebarRow(workspaceId: string): Promise<boolean> {
		return this.eval<boolean>(`(() => {
			const row = document.querySelector('[data-sidebar-row-id="ws::${workspaceId}"]');
			if (!row) return false;
			row.scrollIntoView({ block: "center" });
			return true;
		})()`);
	}

	sidebarRowSelector(workspaceId: string): string {
		return `[data-sidebar-row-id="ws::${workspaceId}"] [role="button"]`;
	}

	async workspaceVisible(workspaceId: string): Promise<boolean> {
		return this.eval<boolean>(`(() => {
			const el = document.querySelector('[data-workspace-id="${workspaceId}"]');
			return !!el && el.getClientRects().length > 0;
		})()`);
	}

	async gotoWorkspace(workspaceId: string): Promise<void> {
		if (
			(await this.currentWorkspaceId()) === workspaceId &&
			(await this.workspaceVisible(workspaceId))
		) {
			return;
		}
		if (await this.revealSidebarRow(workspaceId)) {
			await sleep(150);
			if (await this.clickSelector(this.sidebarRowSelector(workspaceId))) {
				await this.waitWorkspaceVisible(workspaceId);
				return;
			}
		}
		await this.navigateViaPalette(workspaceId);
	}

	async openWorkspaceList(): Promise<void> {
		await pressChord(this.cdp, "meta+shift+k");
		const input = '[role="dialog"] [cmdk-input]';
		await waitFor(
			() =>
				this.eval<boolean>(`(() => {
					const el = document.querySelector('${input}');
					return !!el && el.getClientRects().length > 0;
				})()`),
			{ timeoutMs: 5_000, label: "command palette" },
		);
		const focused = await this.eval<boolean>(
			`document.activeElement?.matches?.('${input}') === true`,
		);
		if (!focused) await this.clickSelector(input);
		await waitFor(
			() =>
				this.eval<boolean>(
					`document.activeElement?.matches?.("[cmdk-input]") === true`,
				),
			{ timeoutMs: 3_000, label: "command palette focus" },
		);
		const title = this.tr.t("Workspaces");
		await insertText(this.cdp, title);
		await waitFor(
			() =>
				this.eval<boolean>(
					`(document.querySelector('[cmdk-item][data-selected="true"], [cmdk-item][aria-selected="true"]')?.textContent ?? "").trim().startsWith(${JSON.stringify(title)})`,
				),
			{ timeoutMs: 5_000, label: "workspaces command" },
		);
		await pressChord(this.cdp, "enter", { allowEnterIn: "cmdk-input" });
		await waitFor(
			() =>
				this.eval<boolean>(
					`!!document.querySelector('[cmdk-item][data-value^="workspace v2 "]')`,
				),
			{ timeoutMs: 5_000, label: "workspace list" },
		);
	}

	async paletteWorkspaceIds(): Promise<string[]> {
		await this.openWorkspaceList();
		const ids = await this.eval<string[]>(
			`[...document.querySelectorAll('[cmdk-item][data-value^="workspace v2 "]')].map((el) => el.getAttribute("data-value") ?? "").filter((value) => !value.includes("perf-bench")).map((value) => value.split(" ")[2]).filter(Boolean)`,
		);
		await this.closeDialogs();
		return ids;
	}

	async closeDialogs(): Promise<void> {
		for (let i = 0; i < 3 && (await this.dialogOpen()); i++) {
			await pressChord(this.cdp, "escape");
			await sleep(250);
		}
	}

	paletteItemSelector(workspaceId: string): string {
		return `[cmdk-item][data-value^="workspace v2 ${workspaceId} "]`;
	}

	async revealPaletteItem(workspaceId: string): Promise<void> {
		await this.openWorkspaceList();
		const item = this.paletteItemSelector(workspaceId);
		await waitFor(
			() =>
				this.eval<boolean>(`(() => {
					const el = document.querySelector('${item}');
					if (!el) return false;
					el.scrollIntoView({ block: "center" });
					return true;
				})()`),
			{ timeoutMs: 5_000, label: "workspace in the palette list" },
		);
		await sleep(150);
	}

	async navigateViaPalette(workspaceId: string): Promise<void> {
		await this.revealPaletteItem(workspaceId);
		if (!(await this.clickSelector(this.paletteItemSelector(workspaceId)))) {
			await this.closeDialogs();
			throw new Error("workspace not clickable in the palette list");
		}
		await this.waitWorkspaceVisible(workspaceId);
	}

	async diagnose(workspaceId: string | null): Promise<string> {
		const snapshot = await this.eval<Record<string, unknown>>(`(() => {
			const id = ${JSON.stringify(workspaceId)};
			const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
			const route = location.hash.replace(uuid, (m) => (m === id ? "<target>" : "<other>"));
			const el = id ? document.querySelector('[data-workspace-id="' + id + '"]') : null;
			const rect = el ? el.getBoundingClientRect() : null;
			return {
				route,
				workspaceElements: document.querySelectorAll("[data-workspace-id]").length,
				targetPresent: !!el,
				targetRect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
				targetParked: !!el?.closest?.("#terminal-parking"),
				hasFocus: document.hasFocus(),
				visibility: document.visibilityState,
				dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
				sidebarRows: document.querySelectorAll('[data-sidebar-row-id^="ws::"]').length,
				targetRowPresent: !!(id && document.querySelector('[data-sidebar-row-id="ws::' + id + '"]')),
			};
		})()`).catch((error) => ({ error: String(error) }));
		return JSON.stringify(snapshot);
	}

	async waitWorkspaceVisible(workspaceId: string, timeoutMs = 20_000) {
		await waitFor(
			() =>
				this.eval<boolean>(`(() => {
					const el = document.querySelector('[data-workspace-id="${workspaceId}"]');
					return !!el && el.getClientRects().length > 0;
				})()`),
			{ timeoutMs, intervalMs: 100, label: "workspace visible" },
		);
	}

	async waitQuiet(): Promise<void> {
		await this.eval("window.__perfProbe.waitQuiet(300, 5000)", 10_000);
		const jitter = ((this.jitterIndex++ * 97) % 251) + 250;
		await sleep(jitter);
	}

	async measure(
		spec: ArmSpec,
		action: () => Promise<void>,
	): Promise<ProbeResult> {
		const token = await this.eval<number>(
			`window.__perfProbe.arm(${JSON.stringify(spec)})`,
		);
		try {
			await action();
		} catch (error) {
			await this.eval(`window.__perfProbe.result(${token})`).catch(() => null);
			throw error;
		}
		return this.eval<ProbeResult>(
			`window.__perfProbe.result(${token})`,
			(spec.timeoutMs ?? 15_000) + 10_000,
		);
	}

	async sample(
		journey: string,
		variant: string,
		phase: Phase,
		spec: ArmSpec,
		action: () => Promise<void>,
		options: {
			maxAttempts?: number;
			before?: () => Promise<void>;
			allowDialog?: boolean;
		} = {},
	): Promise<SampleOutcome> {
		const maxAttempts = options.maxAttempts ?? 3;
		let last: SampleOutcome | null = null;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			await options.before?.();
			let gateFailure: string | null = null;
			if (isScreenLocked()) gateFailure = "screen-locked";
			else if (!(await this.ensureFocus())) gateFailure = "window-unfocused";
			else if (!options.allowDialog && (await this.dialogOpen())) {
				gateFailure = "dialog-open";
			}
			if (!gateFailure) await this.waitQuiet();
			let result: ProbeResult;
			if (gateFailure) {
				result = {
					status: "invalid",
					reason: gateFailure,
					durationMs: null,
					marks: {},
					output: null,
					focusLost: false,
					loafCount: 0,
					loafBlockingMs: 0,
				};
			} else {
				try {
					result = await this.measure(spec, action);
				} catch (error) {
					result = {
						status: "invalid",
						reason: `action-error: ${(error as Error).message.slice(0, 120)}`,
						durationMs: null,
						marks: {},
						output: null,
						focusLost: false,
						loafCount: 0,
						loafBlockingMs: 0,
					};
				}
				if (result.status === "ok" && result.focusLost) {
					result = { ...result, status: "invalid", reason: "focus-lost" };
				}
			}
			const record = this.sink.write({
				journey,
				variant,
				phase,
				attempt,
				status: result.status,
				invalidReason: result.reason,
				durationMs:
					result.durationMs === null
						? null
						: Math.round(result.durationMs * 100) / 100,
				marks: Object.fromEntries(
					Object.entries(result.marks).map(([k, v]) => [
						k,
						Math.round(v * 100) / 100,
					]),
				),
				loafCount: result.loafCount,
				loafBlockingMs: result.loafBlockingMs,
				...(result.diag ? { diag: result.diag } : {}),
				clock: "renderer-perf",
				startSource: spec.start.type,
			});
			last = { record, output: result.output };
			if (result.status !== "invalid") return last;
			this.log(
				`  ${journey}/${variant}: invalid (${result.reason}), attempt ${attempt}`,
			);
			await this.recover();
		}
		return last as SampleOutcome;
	}

	async recover(): Promise<void> {
		await pressChord(this.cdp, "escape").catch(() => undefined);
		await sleep(300);
	}
}
