import { insertText, pressChord } from "../lib/input";
import { sleep, waitFor } from "../lib/system";
import { type BenchContext, phaseFor } from "./context";

export interface CreateHooks {
	project: ProjectChoice;
	beforeSubmit: (name: string) => void;
	verify: (workspaceId: string) => boolean;
	destroy: (workspaceId: string) => Promise<void>;
	knownWorkspaceIds: () => Promise<string[]>;
}

export interface ProjectChoice {
	name: string;
	knownNames: string[];
}

async function projectTriggerText(
	ctx: BenchContext,
	knownNames: string[],
): Promise<string | null> {
	return ctx.session.eval<string | null>(`(() => {
		const known = ${JSON.stringify(knownNames)};
		for (const button of document.querySelectorAll('button[aria-haspopup]')) {
			if (!button.getClientRects().length) continue;
			const text = (button.textContent ?? "").trim();
			if (known.includes(text)) return text;
		}
		return null;
	})()`);
}

async function selectProject(
	ctx: BenchContext,
	project: ProjectChoice,
): Promise<void> {
	const { session } = ctx;
	const current = await projectTriggerText(ctx, project.knownNames);
	if (current === project.name) return;
	if (!current)
		throw new Error("project picker not found on the new-workspace screen");
	if (
		!(await session.clickSelector("button[aria-haspopup]", {
			textEquals: current,
		}))
	) {
		throw new Error("project picker not clickable");
	}
	await waitFor(
		() =>
			session.eval<boolean>(
				`document.activeElement?.matches?.("[cmdk-input]") === true`,
			),
		{ timeoutMs: 5_000, label: "project search" },
	);
	await insertText(session.cdp, project.name);
	await waitFor(
		() =>
			session.eval<boolean>(
				`(document.querySelector('[cmdk-item][data-selected="true"], [cmdk-item][aria-selected="true"]')?.textContent ?? "").trim() === ${JSON.stringify(project.name)}`,
			),
		{ timeoutMs: 5_000, label: "project search result" },
	);
	await pressChord(session.cdp, "enter", { allowEnterIn: "cmdk-input" });
	await waitFor(
		async () =>
			(await projectTriggerText(ctx, project.knownNames)) === project.name,
		{ timeoutMs: 5_000, label: "project selected" },
	);
	await sleep(300);
}

export async function openNewWorkspaceScreen(
	ctx: BenchContext,
	project: ProjectChoice,
): Promise<void> {
	const { session } = ctx;
	await pressChord(session.cdp, "meta+n");
	await waitFor(
		() => session.eval<boolean>(`location.hash.startsWith("#/new-workspace")`),
		{ timeoutMs: 10_000, label: "new workspace screen" },
	);
	await sleep(500);
	const promptEmpty = await session.eval<boolean>(`(() => {
		const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter((el) => el.getClientRects().length > 0);
		return editors.length > 0 && editors.every((el) => (el.textContent ?? "").trim() === "");
	})()`);
	if (!promptEmpty) {
		await pressChord(session.cdp, "escape");
		throw new Error(
			"the new-workspace prompt has a saved draft; refusing to submit it",
		);
	}
	const cloudDefault = await session.eval<boolean>(`(() => {
		try {
			const raw = localStorage.getItem("v2-workspace-create-defaults");
			return !!raw && JSON.parse(raw)?.state?.lastHostId === "cloud";
		} catch { return false; }
	})()`);
	if (cloudDefault) {
		await pressChord(session.cdp, "escape");
		throw new Error(
			"the new-workspace default host is cloud; refusing to submit",
		);
	}
	await selectProject(ctx, project);
}

export async function runCreateWorkspace(
	ctx: BenchContext,
	hooks: CreateHooks,
): Promise<void> {
	const { session, perfBench } = ctx;
	const warmups = ctx.warmups(1);
	const total = warmups + ctx.count(10);
	for (let i = 0; i < total; i++) {
		await session.gotoWorkspace(perfBench.id);
		await openNewWorkspaceScreen(ctx, hooks.project);
		const name = `perf-bench-${ctx.runId}-${i + 1}`;
		hooks.beforeSubmit(name);
		const existing = await hooks.knownWorkspaceIds();
		const outcome = await session.sample(
			"create-workspace",
			"worktree-no-setup",
			phaseFor(i, warmups),
			{
				start: { type: "keydown", code: "Enter", meta: true },
				end: {
					kind: "selector",
					selector: "[data-workspace-id]",
					isNew: true,
					attrNotIn: { name: "data-workspace-id", values: existing },
					attrOut: "data-workspace-id",
				},
				timeoutMs: 90_000,
				jsonMarks: ["workspace:create-settled"],
			},
			() =>
				pressChord(session.cdp, "meta+enter", {
					allowEnterIn: "new-workspace",
				}),
			{ maxAttempts: 1 },
		);
		const createdId = outcome.output;
		await sleep(1000);
		await session.gotoWorkspace(perfBench.id);
		if (createdId) {
			const asRequested = hooks.verify(createdId);
			await hooks.destroy(createdId);
			if (!asRequested) {
				throw new Error(
					"a workspace was created without the requested branch; stopping the create journey",
				);
			}
		}
		await sleep(1500);
	}
}
