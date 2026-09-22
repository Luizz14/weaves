import { z } from "zod";
import { AzureCliCommandError, type ExecAz, execAz } from "./exec-az";

const azureCliVersionSchema = z
	.object({
		"azure-cli": z.string(),
	})
	.passthrough();

const azureDevOpsExtensionSchema = z
	.object({
		name: z.literal("azure-devops"),
		version: z.string(),
	})
	.passthrough();

const azureDevOpsWebUrlSchema = z.url().refine((value) => {
	const url = new URL(value);
	return url.protocol === "https:" && url.hostname === "dev.azure.com";
});

const azureRepositorySchema = z
	.object({
		id: z.string(),
		name: z.string(),
		webUrl: azureDevOpsWebUrlSchema,
		defaultBranch: z.string().nullable().optional(),
		project: z.object({
			id: z.string(),
			name: z.string(),
		}),
	})
	.passthrough();

export type AzureDevOpsProjectConfig = {
	organizationUrl: string;
	azureProject: string;
	repository: string;
};

export type AzureDevOpsDiagnosticStatus =
	| "not_configured"
	| "cli_missing"
	| "extension_missing"
	| "authentication_required"
	| "access_denied"
	| "repository_not_found"
	| "network_error"
	| "timeout"
	| "command_failed"
	| "ready";

export type AzureDevOpsDiagnostic = {
	status: AzureDevOpsDiagnosticStatus;
	cliVersion: string | null;
	extensionVersion: string | null;
	repository: {
		id: string;
		name: string;
		webUrl: string;
		defaultBranch: string | null;
		projectId: string;
		projectName: string;
	} | null;
};

const NETWORK_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
]);

function failedDiagnostic(
	status: AzureDevOpsDiagnosticStatus,
	cliVersion: string | null,
	extensionVersion: string | null,
): AzureDevOpsDiagnostic {
	return {
		status,
		cliVersion,
		extensionVersion,
		repository: null,
	};
}

function combinedErrorText(error: AzureCliCommandError): string {
	return `${error.message}\n${error.stderr}`.toLowerCase();
}

function classifyRepositoryError(error: unknown): AzureDevOpsDiagnosticStatus {
	if (!(error instanceof AzureCliCommandError)) return "command_failed";
	if (error.timedOut) return "timeout";
	if (typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code)) {
		return "network_error";
	}

	const text = combinedErrorText(error);
	if (
		text.includes("please run 'az login'") ||
		text.includes("az devops login") ||
		text.includes("authentication") ||
		text.includes("credential") ||
		text.includes("token has expired")
	) {
		return "authentication_required";
	}
	if (
		text.includes("tf400813") ||
		text.includes("access denied") ||
		text.includes("permission") ||
		text.includes("forbidden") ||
		text.includes("status code: 403")
	) {
		return "access_denied";
	}
	if (
		text.includes("tf401019") ||
		text.includes("repository was not found") ||
		text.includes("repository does not exist") ||
		text.includes("could not be found") ||
		text.includes("status code: 404")
	) {
		return "repository_not_found";
	}
	if (
		text.includes("timed out") ||
		text.includes("connection refused") ||
		text.includes("could not resolve host") ||
		text.includes("temporary failure in name resolution")
	) {
		return "network_error";
	}
	return "command_failed";
}

export async function diagnoseAzureDevOpsProject(
	config: AzureDevOpsProjectConfig,
	options: { execAz?: ExecAz; cwd?: string } = {},
): Promise<AzureDevOpsDiagnostic> {
	const run = options.execAz ?? execAz;
	let cliVersion: string;
	try {
		const version = azureCliVersionSchema.parse(await run(["version"]));
		cliVersion = version["azure-cli"];
	} catch (error) {
		if (error instanceof AzureCliCommandError && error.code === "ENOENT") {
			return failedDiagnostic("cli_missing", null, null);
		}
		if (error instanceof AzureCliCommandError && error.timedOut) {
			return failedDiagnostic("timeout", null, null);
		}
		return failedDiagnostic("command_failed", null, null);
	}

	let extensionVersion: string;
	try {
		const extension = azureDevOpsExtensionSchema.parse(
			await run(["extension", "show", "--name", "azure-devops"]),
		);
		extensionVersion = extension.version;
	} catch (error) {
		if (error instanceof AzureCliCommandError && error.timedOut) {
			return failedDiagnostic("timeout", cliVersion, null);
		}
		const text =
			error instanceof AzureCliCommandError ? combinedErrorText(error) : "";
		if (
			text.includes("no extension found") ||
			text.includes("extension azure-devops is not installed") ||
			text.includes("extension 'azure-devops' is not installed")
		) {
			return failedDiagnostic("extension_missing", cliVersion, null);
		}
		return failedDiagnostic("command_failed", cliVersion, null);
	}

	try {
		const repository = azureRepositorySchema.parse(
			await run(
				[
					"repos",
					"show",
					"--organization",
					config.organizationUrl,
					"--project",
					config.azureProject,
					"--repository",
					config.repository,
					"--detect",
					"false",
				],
				{ cwd: options.cwd },
			),
		);
		return {
			status: "ready",
			cliVersion,
			extensionVersion,
			repository: {
				id: repository.id,
				name: repository.name,
				webUrl: repository.webUrl,
				defaultBranch: repository.defaultBranch ?? null,
				projectId: repository.project.id,
				projectName: repository.project.name,
			},
		};
	} catch (error) {
		return failedDiagnostic(
			classifyRepositoryError(error),
			cliVersion,
			extensionVersion,
		);
	}
}
