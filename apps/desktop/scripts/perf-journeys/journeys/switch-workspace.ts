import type { ArmSpec, Phase } from "../lib/session";
import { sleep } from "../lib/system";
import { sampleChangesPanel } from "./changes-panel";
import { type BenchContext, phaseFor, workspaceScope } from "./context";

const COMPOSER = "textarea:not(.xterm-helper-textarea)";

async function sampleFromPalette(
	ctx: BenchContext,
	journey: string,
	variant: string,
	phase: Phase,
	target: string,
	end: ArmSpec["end"],
): Promise<void> {
	const { session } = ctx;
	if ((await session.currentWorkspaceId()) === target) {
		throw new Error("switch target is already active");
	}
	await session.sample(
		journey,
		variant,
		phase,
		{ start: { type: "pointerdown" }, end, timeoutMs: 20_000 },
		async () => {
			const item = session.paletteItemSelector(target);
			if (!(await session.clickSelector(item))) {
				throw new Error("workspace not clickable in the palette list");
			}
		},
		{
			maxAttempts: 1,
			allowDialog: true,
			before: () => session.revealPaletteItem(target),
		},
	);
	await session.closeDialogs();
	await session.waitWorkspaceVisible(target).catch(() => undefined);
}

function sampleSwitch(
	ctx: BenchContext,
	target: string,
	variant: "revisit" | "first-visit",
	phase: Phase,
): Promise<void> {
	return sampleFromPalette(ctx, "switch-workspace", variant, phase, target, {
		kind: "workspaceTerminal",
		workspaceId: target,
	});
}

function sampleConversation(
	ctx: BenchContext,
	target: string,
	variant: "revisit" | "first-visit",
): Promise<void> {
	return sampleFromPalette(
		ctx,
		"load-conversation",
		variant,
		"measured",
		target,
		{
			kind: "messagesStable",
			within: workspaceScope(target),
			selector: 'article[data-slot="message"]',
			composer: COMPOSER,
			stableMs: 750,
		},
	);
}

export async function runSwitchRevisits(ctx: BenchContext): Promise<void> {
	const { session, perfBench, switchTargets } = ctx;
	if (switchTargets.length === 0) {
		ctx.log("  switch-workspace: no eligible workspace, skipped");
		return;
	}
	await session.gotoWorkspace(perfBench.id);
	for (const target of switchTargets) {
		await session.gotoWorkspace(target);
		await session.gotoWorkspace(perfBench.id);
	}
	const warmups = ctx.warmups(2);
	const total = warmups + ctx.count(30);
	for (let i = 0; i < total; i++) {
		const phase = phaseFor(i, warmups);
		const target = switchTargets[i % switchTargets.length] as string;
		await sampleSwitch(ctx, target, "revisit", phase);
		await sleep(500);
		await session.gotoWorkspace(perfBench.id);
		await sleep(500);
	}
}

export async function runReloadCycles(ctx: BenchContext): Promise<void> {
	const { session, perfBench, switchTargets, chatWorkspace } = ctx;
	const cycles = ctx.count(10);
	for (let cycle = 0; cycle < cycles; cycle++) {
		ctx.log(`  reload cycle ${cycle + 1}/${cycles}`);
		await session.gotoWorkspace(perfBench.id);
		await ctx.reload();
		await sampleChangesPanel(ctx, "cold", "measured");
		for (const target of switchTargets) {
			await sampleSwitch(ctx, target, "first-visit", "measured");
			await sleep(500);
			await session.gotoWorkspace(perfBench.id);
		}
		if (chatWorkspace) {
			await sampleConversation(ctx, chatWorkspace, "first-visit");
			await sleep(500);
			await session.gotoWorkspace(perfBench.id);
			await sleep(500);
			await sampleConversation(ctx, chatWorkspace, "revisit");
			await sleep(500);
			await session.gotoWorkspace(perfBench.id);
		}
	}
}
