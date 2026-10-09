import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("../templates/ide-context-hook.template.cjs", import.meta.url),
);
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), "ide-hook-fixture-"));
	roots.push(root);
	const workspace = path.join(root, "workspace");
	const home = path.join(root, "home");
	const superset = path.join(root, "superset");
	for (const directory of [
		workspace,
		path.join(home, ".claude"),
		path.join(home, ".codex"),
		path.join(superset, "host", "org-fixture"),
	])
		mkdirSync(directory, { recursive: true });
	const file = path.join(workspace, "file.ts");
	const secret = path.join(workspace, ".env");
	writeFileSync(file, "disk contents must never be read into context");
	writeFileSync(secret, "private fixture");
	const snapshot = {
		workspaceId: "workspace-fixture",
		producerId: "00000000-0000-4000-8000-000000000001",
		sequence: 1,
		activated: true,
		openFiles: [file, secret],
		omittedFiles: 0,
		activeFile: {
			path: file,
			documentId: "document-fixture",
			version: 3,
			selection: {
				from: 0,
				to: 20,
				startLine: 1,
				endLine: 1,
				text: "selected <context>🙂",
				truncated: false,
			},
		},
	};
	const preload = path.join(root, "preload.cjs");
	writeFileSync(
		preload,
		`const fs=require('node:fs'); const stat=fs.statSync; fs.statSync=(file,...args)=>{ if(String(file).startsWith('/Library/Application Support/')||String(file).startsWith('/etc/claude-code/')||String(file).startsWith('/etc/codex/')) throw Object.assign(new Error('Fixture absent policy'),{code:'ENOENT'}); return stat(file,...args); };`,
	);
	return { root, workspace, home, superset, file, secret, snapshot, preload };
}

async function runHook(
	f: ReturnType<typeof fixture>,
	harness: "claude" | "codex",
	options: {
		status?: number;
		delay?: number;
		env?: Record<string, string>;
		input?: unknown;
	} = {},
) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			expect(new URL(request.url).pathname).toBe("/ide-context/terminal");
			expect(request.headers.get("authorization")).toBe(
				`Bearer ${"a".repeat(64)}`,
			);
			expect(await request.json()).toEqual({ terminalId: "terminal-fixture" });
			if (options.delay)
				await new Promise((resolve) => setTimeout(resolve, options.delay));
			return Response.json(
				{ workspacePath: f.workspace, snapshot: f.snapshot },
				{ status: options.status ?? 200 },
			);
		},
	});
	writeFileSync(
		path.join(f.superset, "host", "org-fixture", "manifest.json"),
		JSON.stringify({ endpoint: `http://127.0.0.1:${server.port}` }),
	);
	try {
		const child = Bun.spawn(["node", "--require", f.preload, script], {
			env: {
				...process.env,
				HOME: f.home,
				CLAUDE_CONFIG_DIR: path.join(f.home, ".claude"),
				CODEX_HOME: path.join(f.home, ".codex"),
				SUPERSET_HOME_DIR: f.superset,
				SUPERSET_ORGANIZATION_ID: "org-fixture",
				SUPERSET_TERMINAL_ID: "terminal-fixture",
				SUPERSET_WORKSPACE_ID: "workspace-fixture",
				SUPERSET_IDE_CONTEXT_TOKEN: "a".repeat(64),
				SUPERSET_HOOK_HARNESS: harness,
				SUPERSET_AGENT_ID: harness,
				CURSOR_AGENT: "",
				CURSOR_CLI: "",
				CURSOR_VERSION: "",
				ProgramFiles: "",
				...options.env,
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		child.stdin.write(
			JSON.stringify(
				options.input ?? {
					hook_event_name: "UserPromptSubmit",
					cwd: f.workspace,
					prompt: "original user prompt",
				},
			),
		);
		child.stdin.end();
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		return stdout;
	} finally {
		server.stop(true);
	}
}

describe("terminal UserPromptSubmit protocol", () => {
	it("emits provider JSON with unsaved selection, escaped data, and no buffer or prompt", async () => {
		const f = fixture();
		for (const provider of ["claude", "codex"] as const) {
			const output = JSON.parse(await runHook(f, provider));
			expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
			const context = output.hookSpecificOutput.additionalContext;
			expect(context).toContain("\\u003ccontext\\u003e");
			expect(context).not.toContain("original user prompt");
			expect(context).not.toContain("disk contents");
			expect(JSON.parse(context.split("\n")[1]).activeFile.selection.text).toBe(
				f.snapshot.activeFile.selection.text,
			);
		}
	});

	it("filters documented Claude Read denies and suppresses unresolved restrictive policies", async () => {
		const f = fixture();
		writeFileSync(
			path.join(f.home, ".claude", "settings.json"),
			JSON.stringify({ permissions: { deny: ["Read(.env)"] } }),
		);
		const context = JSON.parse(await runHook(f, "claude")).hookSpecificOutput
			.additionalContext;
		expect(context).not.toContain(f.secret);
		expect(context).toContain("selected");
		writeFileSync(
			path.join(f.home, ".claude", "settings.json"),
			JSON.stringify({ permissions: { deny: ["Read(file.ts)"] } }),
		);
		const denied = JSON.parse(await runHook(f, "claude")).hookSpecificOutput
			.additionalContext;
		expect(JSON.parse(denied.split("\n")[1]).activeFile).toBeNull();
		expect(denied).not.toContain("selected");
		writeFileSync(
			path.join(f.home, ".claude", "settings.json"),
			JSON.stringify({ permissions: { deny: ["Read(!file.ts)"] } }),
		);
		expect(await runHook(f, "claude")).toBe("");
	});

	it("keeps harmless Codex named profiles and suppresses actual deny-read policies", async () => {
		const f = fixture();
		const config = path.join(f.home, ".codex", "config.toml");
		writeFileSync(
			config,
			'default_permissions = "workspace"\n[permissions.workspace.filesystem]\n":workspace_roots" = "write"\n',
		);
		expect(await runHook(f, "codex")).toContain("selected");
		writeFileSync(
			config,
			'default_permissions = "workspace"\n[permissions.workspace.filesystem]\n"**/.env" = "deny"\n',
		);
		expect(await runHook(f, "codex")).toBe("");
	});

	it("fails open on missing token, foreign harness, subagent, malformed input, wrong workspace and HTTP errors", async () => {
		const f = fixture();
		expect(
			await runHook(f, "codex", { env: { SUPERSET_IDE_CONTEXT_TOKEN: "" } }),
		).toBe("");
		expect(
			await runHook(f, "claude", { env: { SUPERSET_AGENT_ID: "codex" } }),
		).toBe("");
		expect(
			await runHook(f, "codex", {
				input: {
					hook_event_name: "UserPromptSubmit",
					cwd: f.workspace,
					agent_id: "child",
				},
			}),
		).toBe("");
		expect(await runHook(f, "codex", { input: {} })).toBe("");
		expect(
			await runHook(f, "codex", {
				env: { SUPERSET_WORKSPACE_ID: "other-workspace" },
			}),
		).toBe("");
		expect(await runHook(f, "codex", { status: 401 })).toBe("");
	});

	it("times out locally and keeps output below the provider's spill threshold", async () => {
		const f = fixture();
		expect(await runHook(f, "codex", { delay: 1500 })).toBe("");
		f.snapshot.activeFile.selection.text = "<".repeat(8192);
		const context = JSON.parse(await runHook(f, "codex")).hookSpecificOutput
			.additionalContext;
		expect(context.length).toBeLessThanOrEqual(9000);
		expect(
			JSON.parse(context.split("\n")[1]).activeFile.selection.truncated,
		).toBe(true);
	});
});

it("merges both providers and secondary profiles idempotently, preserves lifecycle/user hooks, and tears down context", async () => {
	const f = fixture();
	const userHook = { hooks: [{ type: "command", command: "user-hook" }] };
	writeFileSync(
		path.join(f.home, ".claude", "settings.json"),
		JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [userHook] } }),
	);
	writeFileSync(
		path.join(f.home, ".codex", "hooks.json"),
		JSON.stringify({ hooks: { UserPromptSubmit: [userHook] } }),
	);
	const modulePath = fileURLToPath(
		new URL("./agent-wrappers-claude-codex-opencode.ts", import.meta.url),
	);
	const secondaryClaude = path.join(f.root, "claude-profile");
	const secondaryCodex = path.join(f.root, "codex-profile");
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`
		import { createClaudeSettingsJson, createCodexHooksJson, ensureClaudeManagedHooksAt, ensureCodexManagedHooksAt, removeClaudeManagedHooks, removeCodexManagedHooks } from ${JSON.stringify(modulePath)};
		import fs from 'node:fs';
		for(let n=0;n<2;n++){ createClaudeSettingsJson(); createCodexHooksJson(); ensureClaudeManagedHooksAt(${JSON.stringify(secondaryClaude)}); ensureCodexManagedHooksAt(${JSON.stringify(secondaryCodex)}); }
		const before={claude:JSON.parse(fs.readFileSync(${JSON.stringify(path.join(f.home, ".claude", "settings.json"))},'utf8')),codex:JSON.parse(fs.readFileSync(${JSON.stringify(path.join(f.home, ".codex", "hooks.json"))},'utf8'))};
		removeClaudeManagedHooks(); removeCodexManagedHooks(); console.log(JSON.stringify(before));
	`,
		],
		{
			env: { ...process.env, HOME: f.home, SUPERSET_HOME_DIR: f.superset },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(code).toBe(0);
	expect(stderr).toBe("");
	const before = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
	for (const provider of [
		before.claude,
		before.codex,
		JSON.parse(
			readFileSync(path.join(secondaryClaude, "settings.json"), "utf8"),
		),
		JSON.parse(readFileSync(path.join(secondaryCodex, "hooks.json"), "utf8")),
	]) {
		const context = provider.hooks.UserPromptSubmit.flatMap(
			(entry: { hooks: Array<{ command: string; timeout: number }> }) =>
				entry.hooks,
		).filter((hook: { command: string }) =>
			hook.command.includes("ide-context.cjs"),
		);
		expect(context).toHaveLength(1);
		expect(context[0].timeout).toBe(2);
		expect(
			provider.hooks.Stop.some((entry: { hooks: Array<{ command: string }> }) =>
				entry.hooks.some((hook) => hook.command.includes("notify.sh")),
			),
		).toBe(true);
	}
	expect(
		before.codex.hooks.UserPromptSubmit.flatMap(
			(entry: {
				hooks: Array<{ command: string; additionalContextLimit?: number }>;
			}) => entry.hooks,
		).find((hook: { command: string }) =>
			hook.command.includes("ide-context.cjs"),
		).additionalContextLimit,
	).toBe(0);
	expect(
		JSON.parse(
			readFileSync(path.join(f.home, ".claude", "settings.json"), "utf8"),
		),
	).toEqual({ theme: "dark", hooks: { UserPromptSubmit: [userHook] } });
	expect(
		JSON.parse(readFileSync(path.join(f.home, ".codex", "hooks.json"), "utf8")),
	).toEqual({ hooks: { UserPromptSubmit: [userHook] } });
});
