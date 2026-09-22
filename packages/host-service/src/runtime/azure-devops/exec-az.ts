import { execFile } from "node:child_process";
import { getToolEnvironment } from "../../terminal/clean-shell-env";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export type ExecAzOptions = {
	cwd?: string;
	timeout?: number;
	maxBuffer?: number;
};

type ProcessOptions = {
	cwd?: string;
	env: Record<string, string>;
	timeout: number;
	maxBuffer: number;
};

type ProcessOutput = {
	stdout: string;
	stderr: string;
};

export type RunAzProcess = (
	file: string,
	args: string[],
	options: ProcessOptions,
) => Promise<ProcessOutput>;

function runAzProcess(
	file: string,
	args: string[],
	options: ProcessOptions,
): Promise<ProcessOutput> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				...options,
				encoding: "utf8",
			},
			(error, stdout, stderr) => {
				if (error) {
					Reflect.set(error, "stdout", stdout);
					Reflect.set(error, "stderr", stderr);
					reject(error);
					return;
				}
				resolve({ stdout, stderr });
			},
		);
	});
}

function errorProperty(error: unknown, key: string): unknown {
	if (typeof error !== "object" || error === null) return undefined;
	return Reflect.get(error, key);
}

function errorStringProperty(error: unknown, key: string): string {
	const value = errorProperty(error, key);
	return typeof value === "string" ? value : "";
}

export class AzureCliCommandError extends Error {
	readonly code: string | number | null;
	readonly signal: string | null;
	readonly stderr: string;
	readonly timedOut: boolean;

	constructor(error: unknown) {
		const message = error instanceof Error ? error.message : "Azure CLI failed";
		super(message, { cause: error });
		this.name = "AzureCliCommandError";
		const code = errorProperty(error, "code");
		this.code =
			typeof code === "string" || typeof code === "number" ? code : null;
		const signal = errorProperty(error, "signal");
		this.signal = typeof signal === "string" ? signal : null;
		this.stderr = errorStringProperty(error, "stderr");
		this.timedOut = errorProperty(error, "killed") === true;
	}
}

export class AzureCliOutputError extends Error {
	constructor() {
		super("Azure CLI returned invalid JSON");
		this.name = "AzureCliOutputError";
	}
}

export type ExecAz = (
	args: string[],
	options?: ExecAzOptions,
) => Promise<unknown>;

type ExecAzDependencies = {
	runProcess?: RunAzProcess;
	getEnvironment?: () => Promise<Record<string, string>>;
};

export function createExecAz(dependencies: ExecAzDependencies = {}): ExecAz {
	const runProcess = dependencies.runProcess ?? runAzProcess;
	const resolveEnvironment = dependencies.getEnvironment ?? getToolEnvironment;

	return async (args, options) => {
		const toolEnvironment = await resolveEnvironment();
		const environment = {
			...toolEnvironment,
			AZURE_CORE_COLLECT_TELEMETRY: "false",
			AZURE_CORE_ONLY_SHOW_ERRORS: "true",
			AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
		};
		let output: ProcessOutput;
		try {
			output = await runProcess(
				"az",
				[...args, "--only-show-errors", "--output", "json"],
				{
					cwd: options?.cwd,
					env: environment,
					timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
					maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER_BYTES,
				},
			);
		} catch (error) {
			throw new AzureCliCommandError(error);
		}

		const stdout = output.stdout.trim();
		if (!stdout) return null;
		try {
			return JSON.parse(stdout);
		} catch {
			throw new AzureCliOutputError();
		}
	};
}

export const execAz = createExecAz();
