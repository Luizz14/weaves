import { describe, expect, test } from "bun:test";
import { createBitriseBuildRequest, triggerBitriseBuild } from "./bitrise";

const baseOptions = {
	token: "test-token",
	branch: "feature/12345-build",
	workItemNumber: "12345",
	developerName: "Dev Example",
	alphaVersionValue: "3.15.",
};

describe("Bitrise build requests", () => {
	test("uses the Android alpha workflow and only sends mock settings for alpha", () => {
		const request = createBitriseBuildRequest({
			...baseOptions,
			platform: "android",
			lane: "alpha",
			addToMocks: true,
		});

		expect(request.build_params).toEqual({
			branch: "feature/12345-build",
			workflow_id: "mac-banese-builds",
			environments: [
				{ is_expand: true, mapped_to: "LANE", value: "alpha" },
				{ is_expand: true, mapped_to: "VERSION_NAME", value: "3.15." },
				{ is_expand: true, mapped_to: "VERSION_NUMBER", value: "" },
				{
					is_expand: true,
					mapped_to: "NOME_DESENVOLVEDOR",
					value: "Dev Example",
				},
				{ is_expand: true, mapped_to: "PLATAFORMA", value: "Android" },
				{ is_expand: true, mapped_to: "NUMERO_US", value: "12345" },
				{ is_expand: true, mapped_to: "ADICIONAR_AOS_MOCKS", value: true },
			],
		});
		expect(request.hook_info.build_trigger_token).toBe("test-token");
	});

	test("uses iOS beta version parameters", () => {
		const request = createBitriseBuildRequest({
			...baseOptions,
			platform: "ios",
			lane: "beta",
			versionName: "4.3.12",
		});

		expect(request.build_params.workflow_id).toBe("mac-banese-builds");
		expect(request.build_params.environments).toEqual([
			{ is_expand: true, mapped_to: "LANE", value: "beta" },
			{ is_expand: true, mapped_to: "VERSION", value: "4.3.12" },
			{
				is_expand: true,
				mapped_to: "NOME_DESENVOLVEDOR",
				value: "Dev Example",
			},
			{ is_expand: true, mapped_to: "PLATAFORMA", value: "iOS" },
			{ is_expand: true, mapped_to: "NUMERO_US", value: "12345" },
		]);
	});

	test("uses the release workflow without alpha-only parameters", () => {
		const request = createBitriseBuildRequest({
			...baseOptions,
			platform: "android",
			lane: "release",
			versionName: "3.16.100",
			versionNumber: "316100",
			addToMocks: true,
		});

		expect(request.build_params.workflow_id).toBe("mac-ofuscador");
		expect(request.build_params.environments).toContainEqual({
			is_expand: true,
			mapped_to: "VERSION_NUMBER",
			value: "316100",
		});
		expect(
			request.build_params.environments.some(
				(environment) => environment.mapped_to === "ADICIONAR_AOS_MOCKS",
			),
		).toBe(false);
	});

	test("reports a safe error when Bitrise rejects a request", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response("sensitive upstream body", { status: 403 });

		await expect(
			triggerBitriseBuild(
				{
					...baseOptions,
					platform: "ios",
					lane: "alpha",
				},
				fetchImpl,
			),
		).rejects.toThrow("HTTP 403");
	});
});
