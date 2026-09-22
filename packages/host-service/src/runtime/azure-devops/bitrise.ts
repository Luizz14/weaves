import type { BitriseBuildPlatform } from "../../db/schema";

export type BitriseBuildLane = "alpha" | "beta" | "release";

export type BitriseBuildRequest = {
	build_params: {
		branch: string;
		workflow_id: string;
		environments: Array<{
			is_expand: true;
			mapped_to: string;
			value: string | boolean;
		}>;
	};
	hook_info: { build_trigger_token: string; type: "bitrise" };
	triggered_by: "curl";
};

export type TriggerBitriseBuildOptions = {
	platform: BitriseBuildPlatform;
	lane: BitriseBuildLane;
	token: string;
	branch: string;
	workItemNumber: string;
	developerName: string;
	alphaVersionValue: string;
	versionName?: string;
	versionNumber?: string;
	addToMocks?: boolean;
};

const BITRISE_APP_IDS: Record<BitriseBuildPlatform, string> = {
	android: "20d2cc52-24ff-4dd1-803d-a8c0c267e362",
	ios: "1285017a-dccf-4121-9f6c-d26a33b677a0",
};

const WORKFLOW_IDS: Record<BitriseBuildLane, string> = {
	alpha: "mac-banese-builds",
	beta: "mac-banese-builds",
	release: "mac-ofuscador",
};

function environment(
	mappedTo: string,
	value: string | boolean,
): BitriseBuildRequest["build_params"]["environments"][number] {
	return { is_expand: true, mapped_to: mappedTo, value };
}

export function createBitriseBuildRequest(
	options: TriggerBitriseBuildOptions,
): BitriseBuildRequest {
	const { platform, lane } = options;
	const versionName =
		lane === "alpha" ? options.alphaVersionValue : (options.versionName ?? "");
	const environments = [
		environment("LANE", lane),
		environment(
			platform === "android" ? "VERSION_NAME" : "VERSION",
			versionName,
		),
	];

	if (platform === "android") {
		environments.push(
			environment(
				"VERSION_NUMBER",
				lane === "alpha" ? "" : (options.versionNumber ?? ""),
			),
		);
	}

	environments.push(
		environment("NOME_DESENVOLVEDOR", options.developerName),
		environment("PLATAFORMA", platform === "android" ? "Android" : "iOS"),
		environment("NUMERO_US", options.workItemNumber),
	);

	if (lane === "alpha") {
		environments.push(
			environment("ADICIONAR_AOS_MOCKS", options.addToMocks ?? false),
		);
	}

	return {
		build_params: {
			branch: options.branch,
			workflow_id: WORKFLOW_IDS[lane],
			environments,
		},
		hook_info: { build_trigger_token: options.token, type: "bitrise" },
		triggered_by: "curl",
	};
}

export async function triggerBitriseBuild(
	options: TriggerBitriseBuildOptions,
	fetchImpl: typeof fetch = fetch,
): Promise<{ dashboardUrl: string }> {
	let response: Response;
	try {
		response = await fetchImpl(
			`https://app.bitrise.io/app/${BITRISE_APP_IDS[options.platform]}/build/start.json`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(createBitriseBuildRequest(options)),
				signal: AbortSignal.timeout(30_000),
			},
		);
	} catch {
		throw new Error("Could not reach Bitrise to start the build");
	}
	if (!response.ok) {
		throw new Error(
			`Bitrise rejected the build request (HTTP ${response.status})`,
		);
	}
	return { dashboardUrl: "https://app.bitrise.io/dashboard" };
}
