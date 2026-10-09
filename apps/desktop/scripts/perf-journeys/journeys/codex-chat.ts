import { pressChord, typeCharacter } from "../lib/input";
import { sleep } from "../lib/system";
import {
	type BenchContext,
	closeAddedTabs,
	phaseFor,
	tabCount,
	workspaceScope,
} from "./context";

const COMPOSER = "textarea:not(.xterm-helper-textarea)";
const CATALOG_TTL_MS = 65_000;

export async function runCodexChat(
	ctx: BenchContext,
	options: { coldSamples: number },
): Promise<void> {
	const { session, perfBench } = ctx;
	await session.gotoWorkspace(perfBench.id);
	const scope = workspaceScope(perfBench.id);
	const baseline = await tabCount(session, perfBench.id);
	const warmups = ctx.warmups(3);
	const total = warmups + ctx.count(30);
	const typingPerChat = 5;
	let typingSamples = 0;
	const typingTarget = ctx.count(50);
	const typingWarmups = ctx.warmups(5);

	const openChat = async (variant: string, phase: "warmup" | "measured") => {
		const outcome = await session.sample(
			"codex-chat-composer",
			variant,
			phase,
			{
				start: { type: "keydown", code: "KeyT", meta: true },
				end: {
					kind: "selector",
					selector: COMPOSER,
					within: scope,
					isNew: true,
					enabled: true,
				},
				timeoutMs: 30_000,
			},
			() => pressChord(session.cdp, "meta+t"),
			{
				before: async () => {
					await session.eval(
						`document.activeElement?.matches?.('${COMPOSER}') && document.activeElement.blur()`,
					);
				},
			},
		);
		return outcome.record.status === "ok";
	};

	const typeInComposer = async () => {
		const focusComposer = async () => {
			const focused = await session.eval<boolean>(
				`document.activeElement?.matches?.('${COMPOSER}') === true && !!document.activeElement.closest('${scope}')`,
			);
			if (!focused) await session.clickSelector(`${scope} ${COMPOSER}`);
			await sleep(100);
		};
		let typed = 0;
		for (
			let k = 0;
			k < typingPerChat && typingSamples < typingWarmups + typingTarget;
			k++
		) {
			await session.sample(
				"codex-composer-keystroke",
				"textarea",
				phaseFor(typingSamples, typingWarmups),
				{
					start: { type: "keydown", code: "KeyA" },
					end: { kind: "textareaChar", selector: COMPOSER, char: "a" },
					timeoutMs: 3_000,
				},
				async () => {
					await typeCharacter(session.cdp, "a");
					typed++;
				},
				{ before: focusComposer },
			);
			typingSamples++;
		}
		if (typed > 0) {
			await focusComposer();
			await pressChord(session.cdp, "meta+a", { editingCommand: true });
			await pressChord(session.cdp, "backspace", { editingCommand: true });
			await sleep(200);
		}
	};

	for (let i = 0; i < total; i++) {
		const ready = await openChat("warm", phaseFor(i, warmups));
		await sleep(300);
		if (ready) await typeInComposer();
		await closeAddedTabs(session, perfBench.id, baseline);
	}

	for (let i = 0; i < options.coldSamples; i++) {
		ctx.log(
			`  codex cold sample ${i + 1}/${options.coldSamples}: waiting ${CATALOG_TTL_MS / 1000}s for the model catalog to expire`,
		);
		await sleep(CATALOG_TTL_MS);
		await openChat("cold-catalog", "measured");
		await sleep(300);
		await closeAddedTabs(session, perfBench.id, baseline);
	}
}
