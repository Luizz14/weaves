import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer } from "node:net";

export function run(
	command: string[],
	options: { allowFailure?: boolean } = {},
): string {
	const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0 && !options.allowFailure) {
		throw new Error(
			`${command[0]} exited ${result.exitCode}: ${result.stderr.toString().trim()}`,
		);
	}
	return result.stdout.toString();
}

export function isScreenLocked(): boolean {
	return /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(
		run(["ioreg", "-n", "Root", "-d1"]),
	);
}

export function isOnAcPower(): boolean {
	return run(["pmset", "-g", "batt"]).includes("AC Power");
}

export function thermalState(): string {
	return run(["pmset", "-g", "therm"], { allowFailure: true })
		.split("\n")
		.filter((line) => /warning|level/i.test(line))
		.map((line) => line.trim())
		.join("; ");
}

export type ProcessRole =
	| "main"
	| "host-service"
	| "pty-daemon"
	| "terminal-host"
	| "helper";

export interface SupersetProcess {
	pid: number;
	ppid: number;
	bundle: string;
	role: ProcessRole;
}

export function supersetProcesses(): SupersetProcess[] {
	const output = run(["ps", "-axo", "pid=,ppid=,args="]);
	const processes: SupersetProcess[] = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
		if (!match) continue;
		const [, pid, ppid, args] = match as [string, string, string, string];
		const bundleMatch = args.match(/^(.*?\/Superset\.app)\/Contents\//);
		if (!bundleMatch?.[1]) continue;
		const bundle = bundleMatch[1];
		let role: ProcessRole = "helper";
		if (args.includes("/host-service.js")) role = "host-service";
		else if (args.includes("/pty-daemon.js")) role = "pty-daemon";
		else if (args.includes("/terminal-host.js")) role = "terminal-host";
		else if (/\/Contents\/MacOS\/Superset(\s|$)/.test(args)) role = "main";
		processes.push({ pid: Number(pid), ppid: Number(ppid), bundle, role });
	}
	return processes;
}

export function mainProcessFor(bundle: string): SupersetProcess | undefined {
	return supersetProcesses().find(
		(process) => process.role === "main" && process.bundle === bundle,
	);
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function frontmostBundlePath(): string | null {
	const asn = run(["lsappinfo", "front"], { allowFailure: true }).trim();
	if (!asn) return null;
	const info = run(["lsappinfo", "info", "-only", "bundlepath", asn], {
		allowFailure: true,
	});
	return (
		info.match(/bundle path="([^"]+)"/)?.[1] ??
		info.match(/"LSBundlePath"="([^"]+)"/)?.[1] ??
		null
	);
}

export async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

export const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(
	probe: () => T | Promise<T>,
	options: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<NonNullable<T>> {
	const deadline = performance.now() + options.timeoutMs;
	while (performance.now() < deadline) {
		const value = await probe();
		if (value) return value as NonNullable<T>;
		await sleep(options.intervalMs ?? 100);
	}
	throw new Error(`timed out waiting for ${options.label}`);
}
