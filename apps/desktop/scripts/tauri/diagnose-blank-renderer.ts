/**
 * Read-only diagnostic for a blank packaged Tauri renderer.
 *
 *   bun apps/desktop/scripts/tauri/diagnose-blank-renderer.ts --port 19322
 *   bun apps/desktop/scripts/tauri/diagnose-blank-renderer.ts --port 19322 --reload
 *
 * The port must be the explicit RENDERER_REMOTE_DEBUG_PORT used to launch the
 * debug app. Output is sanitized JSON on stdout; no profile data is read or
 * written. Reload is opt-in because it restarts the renderer.
 */

const EXPECTED_ORIGIN = "https://tauri.localhost";
const MAX_CAPTURED_ERRORS = 50;
const COMMAND_TIMEOUT_MS = 10_000;
const RELOAD_SETTLE_MS = 6_000;

export interface CdpTarget {
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
}

export interface DiagnosticOptions {
	port: number;
	reload: boolean;
	help: boolean;
}

/** Accept only the exact packaged-app page and its loopback CDP socket. */
export function isExpectedTauriTarget(
	target: CdpTarget,
	port: number,
): boolean {
	if (target.type !== "page" || !target.url || !target.webSocketDebuggerUrl) {
		return false;
	}

	try {
		const pageUrl = new URL(target.url);
		const socketUrl = new URL(target.webSocketDebuggerUrl);
		return (
			pageUrl.origin === EXPECTED_ORIGIN &&
			pageUrl.pathname === "/" &&
			!pageUrl.username &&
			!pageUrl.password &&
			socketUrl.protocol === "ws:" &&
			["127.0.0.1", "localhost", "[::1]"].includes(socketUrl.hostname) &&
			socketUrl.port === String(port) &&
			!socketUrl.username &&
			!socketUrl.password &&
			socketUrl.pathname.startsWith("/devtools/page/")
		);
	} catch {
		return false;
	}
}

/** Keep error text useful while removing common credentials and personal data. */
export function redactDiagnosticText(value: string): string {
	return value
		.split(/[\r\n]/, 1)[0]
		.replace(
			/\b(authorization|proxy-authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|api[_-]?key|session)\b\s*[:=]\s*(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi,
			"$1=[REDACTED]",
		)
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\-/]+=*/gi, "$1 [REDACTED]")
		.replace(
			/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
			"[REDACTED_JWT]",
		)
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
		.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => safeUrlLabel(match))
		.replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[REDACTED_LONG_VALUE]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 400);
}

export function parseDiagnosticArgs(args: string[]): DiagnosticOptions {
	let port: number | undefined;
	let reload = false;
	let help = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--reload") {
			if (reload) throw new Error("--reload may only be supplied once");
			reload = true;
			continue;
		}
		if (arg === "--port") {
			if (port !== undefined)
				throw new Error("--port may only be supplied once");
			const rawPort = args[index + 1];
			if (!rawPort || !/^\d+$/.test(rawPort)) {
				throw new Error("--port requires an explicit TCP port");
			}
			port = Number(rawPort);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	if (help) return { port: port ?? 0, reload, help };
	if (port === undefined)
		throw new Error("--port is required; no default port is used");
	if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
		throw new Error("--port must be an integer between 1024 and 65535");
	}
	return { port, reload, help };
}

function safeUrlLabel(value: string): string {
	try {
		const url = new URL(value);
		if (url.protocol === "file:") return "file://[local resource]";
		if (url.protocol === "data:") return "data:[resource]";
		if (url.protocol === "blob:") return "blob:[resource]";
		return `${url.origin}${url.pathname}`;
	} catch {
		return "[URL]";
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

interface CdpMessage {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { message?: string };
}

class CdpClient {
	private readonly socket: WebSocket;
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (message: CdpMessage) => void; reject: (error: Error) => void }
	>();
	private readonly listeners = new Map<
		string,
		Set<(params: Record<string, unknown>) => void>
	>();

	constructor(socketUrl: string) {
		this.socket = new WebSocket(socketUrl);
		this.socket.addEventListener("message", (event) => {
			let message: CdpMessage;
			try {
				message = JSON.parse(String(event.data)) as CdpMessage;
			} catch {
				return;
			}
			if (message.id !== undefined) {
				const pending = this.pending.get(message.id);
				if (!pending) return;
				this.pending.delete(message.id);
				if (message.error) {
					pending.reject(new Error("CDP command failed"));
				} else {
					pending.resolve(message);
				}
				return;
			}
			if (!message.method) return;
			for (const listener of this.listeners.get(message.method) ?? []) {
				listener(message.params ?? {});
			}
		});
		this.socket.addEventListener("close", () => {
			for (const pending of this.pending.values()) {
				pending.reject(new Error("CDP connection closed"));
			}
			this.pending.clear();
		});
	}

	async connect(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("CDP connection timed out")),
				5_000,
			);
			this.socket.addEventListener(
				"open",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			this.socket.addEventListener(
				"error",
				() => {
					clearTimeout(timer);
					reject(new Error("CDP connection failed"));
				},
				{ once: true },
			);
		});
	}

	command(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<CdpMessage> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("CDP command timed out"));
			}, COMMAND_TIMEOUT_MS);
			this.pending.set(id, {
				resolve: (message) => {
					clearTimeout(timer);
					resolve(message);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(
		method: string,
		listener: (params: Record<string, unknown>) => void,
	): () => void {
		let listeners = this.listeners.get(method);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(method, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners?.delete(listener);
			if (listeners?.size === 0) this.listeners.delete(method);
		};
	}

	waitForEvent(method: string, timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error("Page load timed out"));
			}, timeoutMs);
			const unsubscribe = this.on(method, () => {
				clearTimeout(timer);
				unsubscribe();
				resolve();
			});
		});
	}

	close(): void {
		this.socket.close();
	}
}

interface CapturedError {
	phase: "initial" | "reload";
	timestamp: string;
	kind: "runtime-exception" | "console-error";
	message: string;
}

function firstUsefulLine(value: string): string {
	return value.split(/[\r\n]/).find((line) => line.trim().length > 0) ?? value;
}

function safeScriptArgument(value: unknown): string | null {
	const record = asRecord(value);
	if (!record) return null;
	if (typeof record.value === "string") return record.value;
	const className =
		typeof record.className === "string" ? record.className : "";
	if (
		typeof record.description === "string" &&
		(record.subtype === "error" || className.endsWith("Error"))
	) {
		return firstUsefulLine(record.description);
	}
	return null;
}

const SNAPSHOT_EXPRESSION = `(() => {
  if (location.origin !== ${JSON.stringify(EXPECTED_ORIGIN)} || location.pathname !== "/") {
    return JSON.stringify({ expectedPage: false });
  }
  const root = document.querySelector("app");
  const scripts = Array.from(document.scripts).map((script) => {
    const source = script.src || null;
    const entries = source ? performance.getEntriesByName(source, "resource") : [];
    const latest = entries.length ? entries[entries.length - 1] : null;
    return {
      source,
      performanceEntryObserved: Boolean(latest),
      resourceCompleted: Boolean(latest && latest.responseEnd > 0),
    };
  });
  const appBridge = window.App;
  return JSON.stringify({
    expectedPage: true,
    documentReadyState: document.readyState,
    appRoot: { present: Boolean(root), childElementCount: root ? root.childElementCount : null },
    scripts,
    native: {
      tauriInternalsPresent: "__TAURI_INTERNALS__" in globalThis,
      tauriGlobalPresent: "__TAURI__" in window,
      appBridgePresent: typeof appBridge === "object" && appBridge !== null,
      appBridgeVersionPresent: typeof appBridge?.appVersion === "string",
      appBridgePlatformPresent: typeof appBridge?.platform === "string",
    },
  });
})()`;

interface RendererSnapshot {
	expectedPage: boolean;
	documentReadyState?: string;
	appRoot?: { present: boolean; childElementCount: number | null };
	scripts?: Array<{
		source: string | null;
		performanceEntryObserved: boolean;
		resourceCompleted: boolean;
	}>;
	native?: {
		tauriInternalsPresent: boolean;
		tauriGlobalPresent: boolean;
		appBridgePresent: boolean;
		appBridgeVersionPresent: boolean;
		appBridgePlatformPresent: boolean;
	};
}

async function readSnapshot(client: CdpClient): Promise<RendererSnapshot> {
	const response = await client.command("Runtime.evaluate", {
		expression: SNAPSHOT_EXPRESSION,
		returnByValue: true,
		awaitPromise: true,
	});
	const result = asRecord(response.result?.result);
	const raw = result?.value;
	if (typeof raw !== "string")
		throw new Error("Renderer snapshot was unavailable");
	const snapshot = JSON.parse(raw) as RendererSnapshot;
	if (!snapshot.expectedPage) {
		throw new Error("Renderer navigated away from https://tauri.localhost/");
	}
	return {
		...snapshot,
		scripts: snapshot.scripts?.map((script) => ({
			...script,
			source: script.source
				? redactDiagnosticText(safeUrlLabel(script.source))
				: null,
		})),
	};
}

async function findTarget(port: number): Promise<CdpTarget> {
	let response: Response;
	try {
		response = await fetch(`http://127.0.0.1:${port}/json/list`, {
			signal: AbortSignal.timeout(3_000),
		});
	} catch {
		throw new Error(
			`Could not reach the loopback CDP endpoint on port ${port}`,
		);
	}
	if (!response.ok)
		throw new Error(`CDP target list returned HTTP ${response.status}`);
	const targets = (await response.json()) as CdpTarget[];
	const matches = targets.filter((target) =>
		isExpectedTauriTarget(target, port),
	);
	if (matches.length !== 1) {
		throw new Error(
			matches.length === 0
				? `No exact https://tauri.localhost/ page target found on port ${port}`
				: `Expected one exact https://tauri.localhost/ page target; found ${matches.length}`,
		);
	}
	return matches[0];
}

function captureErrors(client: CdpClient): {
	errors: CapturedError[];
	setPhase: (phase: CapturedError["phase"]) => void;
	stop: () => void;
} {
	const errors: CapturedError[] = [];
	let phase: CapturedError["phase"] = "initial";
	let overflow = 0;
	let stopped = false;
	const append = (kind: CapturedError["kind"], message: string) => {
		if (errors.length >= MAX_CAPTURED_ERRORS) {
			overflow += 1;
			return;
		}
		errors.push({
			phase,
			timestamp: new Date().toISOString(),
			kind,
			message: redactDiagnosticText(message),
		});
	};
	const offException = client.on("Runtime.exceptionThrown", (params) => {
		const details = asRecord(params.exceptionDetails);
		const exception = asRecord(details?.exception);
		const description =
			typeof exception?.description === "string"
				? exception.description
				: typeof details?.text === "string"
					? details.text
					: "JavaScript exception";
		append("runtime-exception", firstUsefulLine(description));
	});
	const offConsole = client.on("Runtime.consoleAPICalled", (params) => {
		if (params.type !== "error") return;
		const args = Array.isArray(params.args)
			? params.args
					.map(safeScriptArgument)
					.filter((value): value is string => Boolean(value))
			: [];
		append("console-error", args.join(" ") || "console.error called");
	});
	return {
		errors,
		setPhase: (nextPhase) => {
			phase = nextPhase;
		},
		stop: () => {
			if (stopped) return;
			stopped = true;
			offException();
			offConsole();
			if (overflow > 0) {
				errors.push({
					phase,
					timestamp: new Date().toISOString(),
					kind: "console-error",
					message: `[${overflow} additional runtime/console errors omitted]`,
				});
			}
		},
	};
}

function printHelp(): void {
	console.log(
		"Usage: bun apps/desktop/scripts/tauri/diagnose-blank-renderer.ts --port <RENDERER_REMOTE_DEBUG_PORT> [--reload]\n" +
			"Reads only the exact https://tauri.localhost/ page target. --reload is opt-in.",
	);
}

async function main(args: string[]): Promise<void> {
	const options = parseDiagnosticArgs(args);
	if (options.help) {
		printHelp();
		return;
	}
	const target = await findTarget(options.port);
	const socketUrl = target.webSocketDebuggerUrl;
	if (!socketUrl) throw new Error("Target has no local debugger socket");

	const client = new CdpClient(socketUrl);
	await client.connect();
	const captured = captureErrors(client);
	try {
		await client.command("Runtime.enable");
		const initial = await readSnapshot(client);
		let afterReload: RendererSnapshot | undefined;
		if (options.reload) {
			await client.command("Page.enable");
			captured.setPhase("reload");
			const loadEvent = client.waitForEvent("Page.loadEventFired", 20_000);
			await Promise.all([client.command("Page.reload"), loadEvent]);
			await new Promise((resolve) => setTimeout(resolve, RELOAD_SETTLE_MS));
			afterReload = await readSnapshot(client);
		}
		captured.stop();
		console.log(
			JSON.stringify(
				{
					diagnostic: "tauri-blank-renderer",
					port: options.port,
					target: { type: "page", origin: EXPECTED_ORIGIN, verified: true },
					reloadRequested: options.reload,
					initial,
					...(afterReload ? { afterReload } : {}),
					capturedErrors: captured.errors,
					errorCaptureWindow: options.reload
						? "attached through reload and 6 seconds after load"
						: "after attachment only; prior startup errors require --reload",
				},
				null,
				2,
			),
		);
	} finally {
		captured.stop();
		client.close();
	}
}

if (import.meta.main) {
	main(Bun.argv.slice(2)).catch((error: unknown) => {
		const message =
			error instanceof Error ? error.message : "Diagnostic failed";
		console.error(`FAIL: ${redactDiagnosticText(message)}`);
		process.exitCode = 1;
	});
}
