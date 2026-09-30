import { describe, expect, test } from "bun:test";
import { resolveActivityBranchCandidate } from "./auto-name-from-activity";
import {
	buildNamingContext,
	collectRecentPrompts,
	type WorkspaceSessionTurns,
} from "./workspace-activity";

const session = (
	turns: WorkspaceSessionTurns["turns"],
	agentId = "claude",
): WorkspaceSessionTurns => ({ agentId, lastEventAt: 0, turns });

describe("buildNamingContext", () => {
	test("leads with the opening request and the agent's first answer", () => {
		const context = buildNamingContext(
			session([
				{ role: "assistant", text: "Olá", at: null },
				{ role: "user", text: "Adicionar aviso de saque", at: null },
				{ role: "assistant", text: "Vou editar o card", at: null },
				{ role: "user", text: "Agora o teste", at: null },
			]),
		);
		expect(context).toBe(
			[
				"Request: Adicionar aviso de saque",
				"Agent: Vou editar o card",
				"Later request: Agora o teste",
			].join("\n"),
		);
	});

	test("is empty without a request", () => {
		expect(
			buildNamingContext(session([{ role: "assistant", text: "x", at: null }])),
		).toBe("");
	});
});

describe("collectRecentPrompts", () => {
	test("returns the newest requests first across sessions", () => {
		const prompts = collectRecentPrompts(
			[
				session(
					[
						{ role: "user", text: "b1", at: 3 },
						{ role: "user", text: "b2", at: 4 },
					],
					"codex",
				),
				session([{ role: "user", text: "a1", at: 1 }]),
			],
			3,
		);
		expect(prompts.map((prompt) => prompt.text)).toEqual(["b2", "b1", "a1"]);
		expect(prompts[0]?.agentId).toBe("codex");
	});

	test("clips long requests to one line", () => {
		const [prompt] = collectRecentPrompts(
			[
				session([
					{ role: "user", text: `linha\n${"x".repeat(200)}`, at: null },
				]),
			],
			1,
			20,
		);
		expect(prompt?.text).toBe(`linha ${"x".repeat(13)}…`);
	});
});

describe("resolveActivityBranchCandidate", () => {
	test("keeps an Azure work item's feature/<id>- shape", () => {
		expect(
			resolveActivityBranchCandidate({
				branchName: "withdrawal-notice",
				externalWorkItemProvider: "azure-devops",
				externalWorkItemId: "381316",
			}),
		).toEqual({
			candidate: "381316-withdrawal-notice",
			fixedPrefix: "feature",
		});
	});

	test("leaves other workspaces to the project prefix", () => {
		expect(
			resolveActivityBranchCandidate({
				branchName: "withdrawal-notice",
				externalWorkItemProvider: null,
				externalWorkItemId: null,
			}),
		).toEqual({ candidate: "withdrawal-notice", fixedPrefix: null });
	});
});
