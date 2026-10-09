import { pressChord } from "../lib/input";
import type { Phase } from "../lib/session";
import { sleep } from "../lib/system";
import {
	type BenchContext,
	closeAddedTabs,
	phaseFor,
	tabCount,
	workspaceScope,
} from "./context";

export async function sampleChangesPanel(
	ctx: BenchContext,
	variant: string,
	phase: Phase,
): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const baseline = await tabCount(session, perfBench.id);
	await session.sample(
		"changes-panel",
		variant,
		phase,
		{
			start: { type: "keydown", code: "KeyL", meta: true, shift: true },
			end: {
				kind: "shadowSelector",
				host: "diffs-container",
				inner: "[data-line]",
				within: workspaceScope(perfBench.id),
			},
			timeoutMs: 20_000,
		},
		() => pressChord(session.cdp, "meta+shift+l"),
		{ maxAttempts: 1 },
	);
	await sleep(300);
	await closeAddedTabs(session, perfBench.id, baseline);
}

export async function runChangesPanelWarm(ctx: BenchContext): Promise<void> {
	const warmups = ctx.warmups(3);
	const total = warmups + ctx.count(30);
	for (let i = 0; i < total; i++) {
		await sampleChangesPanel(ctx, "warm", phaseFor(i, warmups));
	}
}
