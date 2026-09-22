import { describe, expect, test } from "bun:test";
import {
	AzureCliCommandError,
	AzureCliOutputError,
	createExecAz,
} from "./exec-az";

describe("execAz", () => {
	test("runs az with a bounded environment and parses JSON", async () => {
		const calls: unknown[] = [];
		const run = createExecAz({
			getEnvironment: async () => ({ PATH: "/tools", EXISTING: "value" }),
			runProcess: async (file, args, options) => {
				calls.push({ file, args, options });
				return { stdout: '{"name":"azure-devops"}\n', stderr: "" };
			},
		});

		await expect(
			run(["extension", "show", "--name", "azure-devops"], {
				cwd: "/repo",
			}),
		).resolves.toEqual({ name: "azure-devops" });
		expect(calls).toEqual([
			{
				file: "az",
				args: [
					"extension",
					"show",
					"--name",
					"azure-devops",
					"--only-show-errors",
					"--output",
					"json",
				],
				options: {
					cwd: "/repo",
					env: {
						PATH: "/tools",
						EXISTING: "value",
						AZURE_CORE_COLLECT_TELEMETRY: "false",
						AZURE_CORE_ONLY_SHOW_ERRORS: "true",
						AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
					},
					timeout: 15_000,
					maxBuffer: 2 * 1024 * 1024,
				},
			},
		]);
	});

	test("wraps process failures without putting output in the public message", async () => {
		const run = createExecAz({
			getEnvironment: async () => ({}),
			runProcess: async () => {
				throw Object.assign(new Error("process failed"), {
					code: "ENOENT",
					stderr: "sensitive command output",
				});
			},
		});

		try {
			await run(["version"]);
			throw new Error("expected execAz to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(AzureCliCommandError);
			expect(error).toMatchObject({
				message: "process failed",
				code: "ENOENT",
				stderr: "sensitive command output",
			});
		}
	});

	test("rejects non-JSON output", async () => {
		const run = createExecAz({
			getEnvironment: async () => ({}),
			runProcess: async () => ({ stdout: "not json", stderr: "" }),
		});

		await expect(run(["version"])).rejects.toBeInstanceOf(AzureCliOutputError);
	});
});
