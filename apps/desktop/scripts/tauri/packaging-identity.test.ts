import { expect, test } from "bun:test";
import { resolvePackagingIdentity } from "./packaging-identity";

test("stable packaging keeps the production app identity and updater feed", () => {
	expect(resolvePackagingIdentity({ channel: "stable" })).toEqual({
		identifier: "com.superset.desktop",
		productName: "Superset",
		deepLinkScheme: "superset",
		updaterEndpoint:
			"https://github.com/superset-sh/superset/releases/latest/download/latest.json",
	});
});

test("personal packaging keeps the stable app identity and disables remote updates", () => {
	expect(
		resolvePackagingIdentity({ channel: "stable", personalInstall: true }),
	).toEqual({
		identifier: "com.superset.desktop",
		productName: "Superset",
		deepLinkScheme: "superset",
		updaterEndpoint: "https://127.0.0.1:1/tauri-personal/updates-disabled.json",
	});
});

test("personal packaging cannot take the QA or canary identity", () => {
	expect(() =>
		resolvePackagingIdentity({
			channel: "stable",
			qaProfile: "Ex18vx",
			personalInstall: true,
		}),
	).toThrow("TAURI_PERSONAL_INSTALL cannot be combined with TAURI_QA_PROFILE.");
	expect(() =>
		resolvePackagingIdentity({ channel: "canary", personalInstall: true }),
	).toThrow("TAURI_PERSONAL_INSTALL requires the stable channel.");
});

test("canary packaging stays side-by-side with its own updater feed and icon", () => {
	expect(resolvePackagingIdentity({ channel: "canary" })).toEqual({
		identifier: "com.superset.desktop.canary",
		productName: "Superset Canary",
		deepLinkScheme: "superset-canary",
		updaterEndpoint:
			"https://github.com/superset-sh/superset/releases/download/desktop-canary/canary.json",
		icons: [
			"../src/resources/build/icons/icon-canary.icns",
			"../src/resources/build/icons/icon-canary.png",
			"../src/resources/build/icons/icon-canary.ico",
		],
	});
});

test("QA packaging isolates the identity and updater from both release channels", () => {
	expect(
		resolvePackagingIdentity({
			channel: "stable",
			qaProfile: "Ex18vx",
			productName: "Superset QA Ex18vx",
			workspaceName: "tauri-qa-Ex18vx",
		}),
	).toEqual({
		identifier: "com.superset.desktop.qa.ex18vx",
		productName: "Superset QA Ex18vx",
		deepLinkScheme: "superset-tauri-qa-ex18vx",
		updaterEndpoint: "https://127.0.0.1:1/tauri-qa/Ex18vx.json",
	});
});

test("QA profile values cannot fall back to stable identity", () => {
	expect(() =>
		resolvePackagingIdentity({ channel: "stable", qaProfile: "---" }),
	).toThrow("TAURI_QA_PROFILE must contain letters or numbers.");
});
