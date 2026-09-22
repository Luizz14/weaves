import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStrictShellEnvironment } from "../../../terminal/clean-shell-env";

export const QUICK_AI_MODELS = [
	"gemini-3.8-flash-low",
	"gemini-3.8-flash-medium",
	"gemini-3.8-flash-high",
	"gemini-3.7-flash-low",
	"gemini-3.7-flash-medium",
	"gemini-3.7-flash-high",
	"gemini-3.6-flash-low",
	"gemini-3.6-flash-medium",
	"gemini-3.6-flash-high",
	"gemini-3.1-pro-low",
	"gemini-3.1-pro-high",
] as const;
export type QuickAiModel = (typeof QUICK_AI_MODELS)[number];
export type QuickAiJsonSchema = Record<string, unknown>;

export type QuickAiFailureCode =
	| "cli-not-found"
	| "not-authenticated"
	| "timeout"
	| "invalid-response"
	| "generation-failed";

export class QuickAiError extends Error {
	constructor(
		readonly code: QuickAiFailureCode,
		message: string,
	) {
		super(message);
		this.name = "QuickAiError";
	}
}

const TIMEOUT_MS = 35_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const MAX_CONCURRENT_GENERATIONS = 2;
let activeGenerations = 0;
const generationWaiters: (() => void)[] = [];

async function withGenerationSlot<T>(run: () => Promise<T>): Promise<T> {
	if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
		await new Promise<void>((resolve) => generationWaiters.push(resolve));
	}
	activeGenerations++;
	try {
		return await run();
	} finally {
		activeGenerations--;
		generationWaiters.shift()?.();
	}
}

function appendBounded(
	current: string,
	chunk: Buffer,
	maxBytes: number,
): string {
	if (Buffer.byteLength(current) >= maxBytes) return current;
	const remaining = maxBytes - Buffer.byteLength(current);
	return current + chunk.subarray(0, remaining).toString("utf8");
}

function classifyFailure(message: string): QuickAiError {
	const normalized = message.toLowerCase();
	if (
		normalized.includes("authenticate") ||
		normalized.includes("authentication") ||
		normalized.includes("sign in") ||
		normalized.includes("login") ||
		normalized.includes("credential") ||
		normalized.includes("token expired")
	) {
		return new QuickAiError(
			"not-authenticated",
			"Antigravity CLI is not authenticated. Run `agy` in a terminal to sign in.",
		);
	}
	return new QuickAiError(
		"generation-failed",
		message.trim() || "Antigravity CLI could not generate a response.",
	);
}

async function runAgy(
	args: string[],
	stdin = "",
	timeoutMs = TIMEOUT_MS,
	cwd?: string,
) {
	const env = await getStrictShellEnvironment().catch(
		() => process.env as Record<string, string>,
	);
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn("agy", args, {
			cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (
			result: { stdout: string; stderr: string } | QuickAiError,
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			result instanceof QuickAiError ? reject(result) : resolve(result);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(new QuickAiError("timeout", "Antigravity CLI timed out."));
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout = appendBounded(stdout, chunk, MAX_OUTPUT_BYTES);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = appendBounded(stderr, chunk, MAX_ERROR_BYTES);
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			finish(
				error.code === "ENOENT"
					? new QuickAiError(
							"cli-not-found",
							"Antigravity CLI was not found. Install `agy` and restart the app.",
						)
					: classifyFailure(error.message),
			);
		});
		child.once("close", (code) => {
			if (code !== 0) {
				finish(classifyFailure(stderr || stdout));
				return;
			}
			finish({ stdout, stderr });
		});
		child.stdin.on("error", () => {});
		child.stdin.end(stdin);
	});
}

export async function getAgyCliVersion(): Promise<string | null> {
	try {
		const { stdout } = await runAgy(["--version"], "", 5_000);
		return stdout.trim() || null;
	} catch (error) {
		if (error instanceof QuickAiError && error.code === "cli-not-found") {
			return null;
		}
		throw error;
	}
}

export async function runAgyJson(
	model: QuickAiModel,
	instructions: string,
	context: string,
	jsonSchema: QuickAiJsonSchema,
): Promise<unknown> {
	return withGenerationSlot(() =>
		runAgyJsonWithSlot(model, instructions, context, jsonSchema),
	);
}

async function runAgyJsonWithSlot(
	model: QuickAiModel,
	instructions: string,
	context: string,
	jsonSchema: QuickAiJsonSchema,
): Promise<unknown> {
	const runDirectory = await mkdtemp(join(tmpdir(), "superset-quick-ai-"));
	const prompt = `${instructions}\n\n<context>\n${context}\n</context>`;
	try {
		const { stdout } = await runAgy(
			[
				"--model",
				model,
				"--sandbox",
				"--disable-slash-commands",
				"--output-format",
				"json",
				"--json-schema",
				JSON.stringify(jsonSchema),
				"--print-timeout",
				"30s",
				"--print",
				prompt,
			],
			"",
			TIMEOUT_MS,
			runDirectory,
		);
		return parseAgyJsonOutput(stdout);
	} finally {
		await rm(runDirectory, { recursive: true, force: true }).catch(() => {});
	}
}

export function parseAgyJsonOutput(stdout: string): unknown {
	let envelope: unknown;
	try {
		envelope = JSON.parse(stdout);
	} catch {
		throw new QuickAiError(
			"invalid-response",
			"Antigravity CLI returned invalid JSON.",
		);
	}
	if (
		typeof envelope !== "object" ||
		envelope === null ||
		!("structured_output" in envelope) ||
		typeof envelope.structured_output !== "object" ||
		envelope.structured_output === null
	) {
		throw new QuickAiError(
			"invalid-response",
			"Antigravity CLI response did not contain structured output.",
		);
	}
	return envelope.structured_output;
}
