import { describe, expect, test } from "bun:test";
import { diagnoseAzureDevOpsProject } from "./diagnostics";
import { AzureCliCommandError, type ExecAz } from "./exec-az";

const config = {
	organizationUrl: "https://dev.azure.com/acme",
	azureProject: "Platform",
	repository: "superset",
};

function processError(
	message: string,
	options: { code?: string; stderr?: string; killed?: boolean } = {},
) {
	return new AzureCliCommandError(Object.assign(new Error(message), options));
}

describe("diagnoseAzureDevOpsProject", () => {
	test("returns the repository identity after all three checks pass", async () => {
		const calls: string[][] = [];
		const responses = [
			{ "azure-cli": "2.78.0" },
			{ name: "azure-devops", version: "1.0.2" },
			{
				id: "repo-id",
				name: "superset",
				webUrl: "https://dev.azure.com/acme/Platform/_git/superset",
				defaultBranch: "refs/heads/main",
				project: { id: "project-id", name: "Platform" },
			},
		];
		const run: ExecAz = async (args) => {
			calls.push(args);
			return responses.shift();
		};

		await expect(
			diagnoseAzureDevOpsProject(config, { execAz: run, cwd: "/repo" }),
		).resolves.toEqual({
			status: "ready",
			cliVersion: "2.78.0",
			extensionVersion: "1.0.2",
			repository: {
				id: "repo-id",
				name: "superset",
				webUrl: "https://dev.azure.com/acme/Platform/_git/superset",
				defaultBranch: "refs/heads/main",
				projectId: "project-id",
				projectName: "Platform",
			},
		});
		expect(calls).toEqual([
			["version"],
			["extension", "show", "--name", "azure-devops"],
			[
				"repos",
				"show",
				"--organization",
				"https://dev.azure.com/acme",
				"--project",
				"Platform",
				"--repository",
				"superset",
				"--detect",
				"false",
			],
		]);
	});

	test("stops when az is missing", async () => {
		let calls = 0;
		const run: ExecAz = async () => {
			calls++;
			throw processError("spawn az ENOENT", { code: "ENOENT" });
		};

		await expect(
			diagnoseAzureDevOpsProject(config, { execAz: run }),
		).resolves.toMatchObject({ status: "cli_missing" });
		expect(calls).toBe(1);
	});

	test("reports a missing extension without probing the repository", async () => {
		let calls = 0;
		const run: ExecAz = async () => {
			calls++;
			if (calls === 1) return { "azure-cli": "2.78.0" };
			throw processError("extension missing", {
				stderr: "The extension azure-devops is not installed.",
			});
		};

		await expect(
			diagnoseAzureDevOpsProject(config, { execAz: run }),
		).resolves.toEqual({
			status: "extension_missing",
			cliVersion: "2.78.0",
			extensionVersion: null,
			repository: null,
		});
		expect(calls).toBe(2);
	});

	test("classifies repository authentication failures", async () => {
		let calls = 0;
		const run: ExecAz = async () => {
			calls++;
			if (calls === 1) return { "azure-cli": "2.78.0" };
			if (calls === 2) return { name: "azure-devops", version: "1.0.2" };
			throw processError("request failed", {
				stderr: "Please run 'az login' to setup account.",
			});
		};

		await expect(
			diagnoseAzureDevOpsProject(config, { execAz: run }),
		).resolves.toMatchObject({
			status: "authentication_required",
			cliVersion: "2.78.0",
			extensionVersion: "1.0.2",
		});
	});
});
