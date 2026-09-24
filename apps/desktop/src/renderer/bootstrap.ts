import { initBootErrorHandling, reportBootError } from "./lib/boot-errors";
import { initializeDesktopBridge, invokeNative } from "./lib/native-bridge";
import { importLegacyProfileStorage } from "./lib/profile-migration";
import { electronTrpcClient } from "./lib/trpc-client";

function applyMigratedTheme(): void {
	const themeType = localStorage.getItem("theme-type");
	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(
		themeType === "light" ? "light" : "dark",
	);
}

async function startRenderer(): Promise<void> {
	initBootErrorHandling(document.querySelector("app"));
	await initializeDesktopBridge();
	await importLegacyProfileStorage();
	await electronTrpcClient.browser.importLegacyCookies
		.mutate()
		.catch((error: unknown) => {
			console.warn("[browser] legacy cookie migration skipped", error);
		});
	applyMigratedTheme();

	if (process.env.NODE_ENV !== "production") {
		const { initializeReactDevToolsBackend } = await import(
			"./lib/react-devtools"
		);
		initializeReactDevToolsBackend();
	}
	await import("./index");
}

void startRenderer().catch((error: unknown) => {
	reportBootError("Render failed", error);
	void invokeNative("app.rendererBootFailed", {
		message: error instanceof Error ? error.message : String(error),
	}).catch(() => {});
});
