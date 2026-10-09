import { pressChord, typeCharacter } from "../lib/input";
import { sleep } from "../lib/system";
import { type BenchContext, phaseFor, workspaceScope } from "./context";

export async function runKeystrokeEcho(ctx: BenchContext): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const focusTerminal = async () => {
		const focused = await session.eval<boolean>(
			`document.activeElement?.classList?.contains("xterm-helper-textarea") === true && !!document.activeElement.closest('${workspaceScope(perfBench.id)}')`,
		);
		if (focused) return;
		await session.clickSelector(
			`${workspaceScope(perfBench.id)} .xterm-screen`,
		);
		await sleep(200);
	};
	let typed = 0;
	const clearTyped = async () => {
		for (; typed > 0; typed--) await pressChord(session.cdp, "backspace");
		await sleep(300);
	};
	const warmups = ctx.warmups(10);
	const total = warmups + ctx.count(100);
	try {
		for (let i = 0; i < total; i++) {
			await session.sample(
				"keystroke-echo",
				"terminal",
				phaseFor(i, warmups),
				{
					start: { type: "keydown", code: "KeyX" },
					end: { kind: "terminalEcho", byte: 0x78 },
					timeoutMs: 5_000,
				},
				async () => {
					await typeCharacter(session.cdp, "x");
					typed++;
				},
				{ before: focusTerminal },
			);
			if (typed >= 20) await clearTyped();
		}
	} finally {
		await focusTerminal();
		await clearTyped();
	}
}
