import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseClaudeTurns,
	parseCodexTurns,
	readHarnessTurns,
} from "./harness-transcript";

const created: string[] = [];

afterEach(() => {
	for (const dir of created.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	created.push(dir);
	return dir;
}

const jsonl = (records: unknown[]) =>
	records.map((record) => JSON.stringify(record)).join("\n");

describe("parseClaudeTurns", () => {
	test("keeps typed prompts and assistant text, drops harness noise", () => {
		const turns = parseClaudeTurns(
			jsonl([
				{
					type: "user",
					isMeta: true,
					message: { role: "user", content: "Caveat: local command" },
				},
				{
					type: "user",
					message: {
						role: "user",
						content: "<command-name>/model</command-name>",
					},
				},
				{
					type: "user",
					timestamp: "2026-09-29T12:00:00.000Z",
					message: { role: "user", content: "Adicionar aviso de saque" },
				},
				{
					type: "assistant",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", text: "hmm" },
							{ type: "text", text: "Vou ajustar o card." },
						],
					},
				},
				{
					type: "user",
					message: {
						role: "user",
						content: [{ type: "tool_result", content: "ok" }],
					},
				},
				{
					type: "user",
					isSidechain: true,
					message: { role: "user", content: "subagent task" },
				},
				{
					type: "user",
					message: {
						role: "user",
						content: "[Request interrupted by user]",
					},
				},
				"not json",
			]),
		);
		expect(turns).toEqual([
			{
				role: "user",
				text: "Adicionar aviso de saque",
				at: Date.parse("2026-09-29T12:00:00.000Z"),
			},
			{ role: "assistant", text: "Vou ajustar o card.", at: null },
		]);
	});
});

describe("parseCodexTurns", () => {
	test("prefers event messages over model-facing items", () => {
		const turns = parseCodexTurns(
			jsonl([
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "<environment_context>…" }],
					},
				},
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "Criar menu de serviço" }],
					},
				},
				{
					type: "event_msg",
					timestamp: "2026-09-29T12:00:00.000Z",
					payload: { type: "user_message", message: "Criar menu de serviço" },
				},
				{
					type: "event_msg",
					payload: { type: "agent_message", message: "Feito." },
				},
			]),
		);
		expect(turns).toEqual([
			{
				role: "user",
				text: "Criar menu de serviço",
				at: Date.parse("2026-09-29T12:00:00.000Z"),
			},
			{ role: "assistant", text: "Feito.", at: null },
		]);
	});

	test("falls back to response items, skipping injected context", () => {
		const turns = parseCodexTurns(
			jsonl([
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [
							{ type: "input_text", text: "# AGENTS.md instructions for /x" },
						],
					},
				},
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "Corrigir o SDK" }],
					},
				},
				{
					type: "response_item",
					payload: {
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "Corrigido." }],
					},
				},
			]),
		);
		expect(turns.map((turn) => turn.text)).toEqual([
			"Corrigir o SDK",
			"Corrigido.",
		]);
	});
});

describe("readHarnessTurns", () => {
	test("reads a Claude session from a pinned config dir", () => {
		const configDir = tempDir("claude-config-");
		const worktreePath = tempDir("worktree-");
		const sessionId = "11111111-2222-4333-8444-555555555555";
		const dir = join(
			configDir,
			"projects",
			worktreePath.replaceAll(/[/.]/g, "-"),
		);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `${sessionId}.jsonl`),
			jsonl([{ type: "user", message: { role: "user", content: "Oi" } }]),
		);
		expect(
			readHarnessTurns({
				agentId: "claude",
				agentSessionId: sessionId,
				worktreePath,
				env: { CLAUDE_CONFIG_DIR: configDir },
			}),
		).toEqual([{ role: "user", text: "Oi", at: null }]);
	});

	test("finds a Codex rollout in its date directories", () => {
		const codexHome = tempDir("codex-home-");
		const sessionId = "0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee";
		const dir = join(codexHome, "sessions", "2026", "09", "29");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `rollout-2026-09-29T12-00-00-${sessionId}.jsonl`),
			jsonl([
				{
					type: "event_msg",
					payload: { type: "user_message", message: "Ajustar iOS" },
				},
			]),
		);
		expect(
			readHarnessTurns({
				agentId: "codex",
				agentSessionId: sessionId,
				worktreePath: null,
				env: { CODEX_HOME: codexHome },
			}),
		).toEqual([{ role: "user", text: "Ajustar iOS", at: null }]);
	});

	test("returns null for harnesses without a readable store", () => {
		expect(
			readHarnessTurns({
				agentId: "grok",
				agentSessionId: "abc",
				worktreePath: "/tmp",
			}),
		).toBeNull();
	});
});
