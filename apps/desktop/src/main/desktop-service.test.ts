import { describe, expect, test } from "bun:test";
import {
	observeDeepLinkProcessing,
	requestQuitApproval,
} from "./desktop-service";

describe("desktop-service deep links", () => {
	test("logs processing failures without exposing rejected data", async () => {
		const reports: string[] = [];
		const rejectedProcessing = Promise.reject(
			new Error("superset://auth/callback?token=secret-token"),
		);

		await observeDeepLinkProcessing(rejectedProcessing, (message) =>
			reports.push(message),
		);

		expect(reports).toEqual(["[desktop-service] Deep-link processing failed"]);
	});
});

describe("desktop-service quit approval", () => {
	test("skips confirmation in development", async () => {
		const result = await requestQuitApproval({
			isDev: true,
			confirmOnQuit: true,
			showMessageBox: async () => {
				throw new Error("dialog should not open");
			},
		});
		expect(result).toEqual({ allow: true });
	});

	test("skips confirmation when disabled", async () => {
		const result = await requestQuitApproval({
			isDev: false,
			confirmOnQuit: false,
			showMessageBox: async () => {
				throw new Error("dialog should not open");
			},
		});
		expect(result).toEqual({ allow: true });
	});

	test("allows Quit and blocks Cancel", async () => {
		const quit = await requestQuitApproval({
			isDev: false,
			confirmOnQuit: true,
			showMessageBox: async () => ({ response: 0 }),
		});
		const cancel = await requestQuitApproval({
			isDev: false,
			confirmOnQuit: true,
			showMessageBox: async () => ({ response: 1 }),
		});
		expect(quit).toEqual({ allow: true });
		expect(cancel).toEqual({ allow: false });
	});

	test("allows quit if the dialog fails", async () => {
		const result = await requestQuitApproval({
			isDev: false,
			confirmOnQuit: true,
			showMessageBox: async () => {
				throw new Error("native dialog unavailable");
			},
		});
		expect(result).toEqual({ allow: true });
	});
});
