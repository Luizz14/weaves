import { afterAll, expect, mock, test } from "bun:test";

const originalPersonalInstall = process.env.TAURI_PERSONAL_INSTALL;
process.env.TAURI_PERSONAL_INSTALL = "1";
const invokeNative = mock(async () => null);

mock.module("main/native/platform", () => ({
	getNativeAppVersion: () => "1.29.0",
	getNativePath: () => "/tmp/superset-updater-test",
	invokeNative,
	onNativeEventNamed: () => () => {},
	showNativeMessageBox: mock(async () => ({ response: 0 })),
}));

const {
	checkForUpdates,
	checkForUpdatesInteractive,
	getUpdateManifestUrl,
	setupAutoUpdater,
} = await import("./auto-updater");

afterAll(() => {
	mock.restore();
	if (originalPersonalInstall === undefined) {
		delete process.env.TAURI_PERSONAL_INSTALL;
	} else {
		process.env.TAURI_PERSONAL_INSTALL = originalPersonalInstall;
	}
});

test("stable builds check the stable latest manifest", () => {
	expect(getUpdateManifestUrl(false)).toBe(
		"https://github.com/superset-sh/superset/releases/latest/download/latest.json",
	);
});

test("prerelease builds check the canary manifest", () => {
	expect(getUpdateManifestUrl(true)).toBe(
		"https://github.com/superset-sh/superset/releases/download/desktop-canary/canary.json",
	);
});

test("personal builds do not configure or check the updater", () => {
	setupAutoUpdater();
	checkForUpdates();
	checkForUpdatesInteractive();

	expect(invokeNative).not.toHaveBeenCalled();
});
