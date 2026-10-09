import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pressChord, typeInShell } from "../lib/input";
import { sleep, waitFor } from "../lib/system";
import {
	type BenchContext,
	closeAddedTabs,
	phaseFor,
	tabCount,
	workspaceScope,
} from "./context";

export async function runClaudeSession(ctx: BenchContext): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const scope = workspaceScope(perfBench.id);
	const baseline = await tabCount(session, perfBench.id);
	const warmups = ctx.warmups(1);
	const total = warmups + ctx.count(10);
	for (let i = 0; i < total; i++) {
		await pressChord(session.cdp, "meta+j");
		await waitFor(
			async () => (await tabCount(session, perfBench.id)) > baseline,
			{ timeoutMs: 10_000, label: "shell for claude" },
		);
		await session.eval("window.__perfProbe.waitQuiet(1500, 20000)", 20_000);
		let echoed = false;
		for (let attempt = 0; attempt < 3 && !echoed; attempt++) {
			if (attempt > 0) {
				await sleep(2000);
				await pressChord(session.cdp, "ctrl+u");
				await sleep(300);
			}
			await session.eval("window.__perfProbe.startEcho()");
			await typeInShell(session.cdp, "claude", scope);
			echoed = await waitFor(
				() =>
					session.eval<boolean>(`window.__perfProbe.echoIncludes("claude")`),
				{ timeoutMs: 3_000, intervalMs: 50, label: "shell echo" },
			).catch(() => false);
		}
		if (!echoed) {
			ctx.log(
				"  claude-session: the shell did not echo the command; sample skipped",
			);
			await closeAddedTabs(session, perfBench.id, baseline);
			continue;
		}
		await sleep(300);
		const outcome = await session.sample(
			"claude-session",
			"shell",
			phaseFor(i, warmups),
			{
				start: { type: "keydown", code: "Enter" },
				end: { kind: "claudeReady", watch: "input-socket" },
				timeoutMs: 60_000,
			},
			() =>
				pressChord(session.cdp, "enter", { allowEnterIn: { shellIn: scope } }),
			{ maxAttempts: 1 },
		);
		const debugDir = process.env.PERF_JOURNEYS_DEBUG_DIR;
		if (debugDir && outcome.record.status === "timeout") {
			const shot = await session.cdp.send<{ data: string }>(
				"Page.captureScreenshot",
				{ format: "png" },
			);
			writeFileSync(
				join(debugDir, `claude-timeout-${i + 1}.png`),
				Buffer.from(shot.data, "base64"),
				{ mode: 0o600 },
			);
		}
		await sleep(1000);
		await closeAddedTabs(session, perfBench.id, baseline);
		if (outcome.record.invalidReason === "blocked-prompt") {
			ctx.log(
				"  claude-session: Claude Code asked for a one-time confirmation (folder trust). Accept it by hand in the perf-bench workspace and rerun with --journeys claude-session.",
			);
			return;
		}
		await sleep(1500);
	}
}
