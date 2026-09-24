export type PackagingIdentityOptions = {
	channel: "stable" | "canary";
	qaProfile?: string;
	personalInstall?: boolean;
	productName?: string;
	workspaceName?: string;
};

export type PackagingIdentity = {
	identifier: string;
	productName: string;
	deepLinkScheme: string;
	updaterEndpoint: string;
	icons?: string[];
};

const STABLE_UPDATER_ENDPOINT =
	"https://github.com/superset-sh/superset/releases/latest/download/latest.json";
const CANARY_UPDATER_ENDPOINT =
	"https://github.com/superset-sh/superset/releases/download/desktop-canary/canary.json";
const PERSONAL_UPDATER_ENDPOINT =
	"https://127.0.0.1:1/tauri-personal/updates-disabled.json";

export function resolvePackagingIdentity(
	options: PackagingIdentityOptions,
): PackagingIdentity {
	const qaProfile = options.qaProfile?.trim();
	if (options.personalInstall) {
		if (options.channel !== "stable") {
			throw new Error("TAURI_PERSONAL_INSTALL requires the stable channel.");
		}
		if (qaProfile) {
			throw new Error(
				"TAURI_PERSONAL_INSTALL cannot be combined with TAURI_QA_PROFILE.",
			);
		}
		return {
			identifier: "com.superset.desktop",
			productName: "Superset",
			deepLinkScheme: "superset",
			updaterEndpoint: PERSONAL_UPDATER_ENDPOINT,
		};
	}

	if (qaProfile) {
		const slug = qaProfile
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 24);
		if (!slug)
			throw new Error("TAURI_QA_PROFILE must contain letters or numbers.");

		const workspaceName = options.workspaceName?.trim() || `tauri-qa-${slug}`;
		return {
			identifier: `com.superset.desktop.qa.${slug}`,
			productName: options.productName?.trim() || `Superset QA ${slug}`,
			deepLinkScheme: schemeForWorkspace(workspaceName),
			updaterEndpoint: `https://127.0.0.1:1/tauri-qa/${encodeURIComponent(qaProfile)}.json`,
		};
	}

	if (options.channel === "canary") {
		return {
			identifier: "com.superset.desktop.canary",
			productName: "Superset Canary",
			deepLinkScheme: "superset-canary",
			updaterEndpoint: CANARY_UPDATER_ENDPOINT,
			icons: [
				"../src/resources/build/icons/icon-canary.icns",
				"../src/resources/build/icons/icon-canary.png",
				"../src/resources/build/icons/icon-canary.ico",
			],
		};
	}

	return {
		identifier: "com.superset.desktop",
		productName: "Superset",
		deepLinkScheme: "superset",
		updaterEndpoint: STABLE_UPDATER_ENDPOINT,
	};
}

function schemeForWorkspace(workspaceName: string): string {
	const normalized = workspaceName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	return normalized && normalized !== "superset"
		? `superset-${normalized.slice(0, 32)}`
		: "superset";
}
