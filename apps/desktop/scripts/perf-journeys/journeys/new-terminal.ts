import { pressChord } from "../lib/input";
import { sleep } from "../lib/system";
import {
	type BenchContext,
	closeAddedTabs,
	phaseFor,
	tabCount,
} from "./context";

export async function runNewTerminal(ctx: BenchContext): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const baseline = await tabCount(session, perfBench.id);
	const warmups = ctx.warmups(3);
	const total = warmups + ctx.count(30);
	for (let i = 0; i < total; i++) {
		await session.sample(
			"new-terminal",
			"warm",
			phaseFor(i, warmups),
			{
				start: { type: "keydown", code: "KeyJ", meta: true },
				end: { kind: "terminalBytes", workspaceId: perfBench.id },
				timeoutMs: 15_000,
			},
			() => pressChord(session.cdp, "meta+j"),
		);
		await sleep(400);
		await closeAddedTabs(session, perfBench.id, baseline);
	}
}
