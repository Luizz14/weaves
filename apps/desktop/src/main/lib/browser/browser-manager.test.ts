import { afterEach, describe, expect, mock, test } from "bun:test";

const nativeEvents: Array<(event: unknown) => void> = [];
const nativeCalls: Array<{
	method: string;
	params: unknown;
	windowLabel?: string;
}> = [];
const nativePanes = new Map<
	string,
	{
		paneId: string;
		workspaceId: string | null;
		url: string;
		title: string;
		isLoading: boolean;
		canGoBack: boolean;
		canGoForward: boolean;
		zoomFactor: number;
		ownerLabel: string;
		infoError?: Error;
	}
>();
let nativeCreateHook: (() => Promise<void>) | null = null;

mock.module("main/native/platform", () => ({
	invokeNative: mock(
		async (
			method: string,
			params: unknown,
			_timeout: number | null,
			windowLabel?: string,
		) => {
			nativeCalls.push({ method, params, windowLabel });
			if (method === "browser.pane.create") {
				const input = params as {
					paneId: string;
					workspaceId?: string | null;
					url: string;
				};
				if (nativeCreateHook) await nativeCreateHook();
				if (nativePanes.has(input.paneId))
					throw new Error(`browser pane ${input.paneId} already exists`);
				const pane = {
					paneId: input.paneId,
					workspaceId: input.workspaceId ?? null,
					url: input.url,
					title: "",
					isLoading: false,
					canGoBack: false,
					canGoForward: false,
					zoomFactor: 1,
				};
				nativePanes.set(input.paneId, {
					...pane,
					ownerLabel: windowLabel ?? "",
				});
				return pane;
			}
			if (method === "browser.pane.screenshot")
				return { base64: "cG5n", url: "https://example.com" };
			if (method === "browser.pane.evaluate") return 42;
			if (
				method === "browser.pane.info" ||
				method === "browser.pane.navigate" ||
				method === "browser.pane.destroy" ||
				method === "browser.pane.setBounds" ||
				method === "browser.pane.setVisibility"
			) {
				const paneId = (params as { paneId: string }).paneId;
				const pane = nativePanes.get(paneId);
				if (!pane) throw new Error(`no browser pane ${paneId}`);
				if (pane.ownerLabel !== windowLabel)
					throw new Error("browser pane belongs to another trusted renderer");
				if (method === "browser.pane.info") {
					if (pane.infoError) throw pane.infoError;
					const {
						ownerLabel: _ownerLabel,
						infoError: _infoError,
						...info
					} = pane;
					return { ...info };
				}
				if (method === "browser.pane.navigate") {
					pane.url = (params as { url: string }).url;
				}
				if (method === "browser.pane.destroy") nativePanes.delete(paneId);
			}
			return { success: true };
		},
	),
	onNativeEvent: (listener: (event: unknown) => void) => {
		nativeEvents.push(listener);
		return () => {
			const index = nativeEvents.indexOf(listener);
			if (index >= 0) nativeEvents.splice(index, 1);
		};
	},
	getNativePath: () => "/tmp/superset",
}));

mock.module("main/lib/browser/screenshot-manager", () => ({
	screenshotManager: {},
}));

const { browserManager, resolveGuestUrl } = await import(
	"main/lib/browser/browser-manager"
);
const { createBrowserRouter } = await import(
	"../../../lib/trpc/routers/browser/browser"
);

afterEach(async () => {
	for (const pane of browserManager.listPanes())
		await browserManager.unregister(pane.paneId);
	nativePanes.clear();
	nativeCalls.length = 0;
});

describe("resolveGuestUrl", () => {
	test("keeps allowed URLs and normalizes host input", () => {
		expect(resolveGuestUrl("https://example.com")).toBe("https://example.com");
		expect(resolveGuestUrl("localhost:3000")).toBe("http://localhost:3000");
	});

	test("rejects privileged schemes before native dispatch", () => {
		expect(() => resolveGuestUrl("file:///etc/passwd")).toThrow("Refusing");
	});
});

describe("native pane coordination", () => {
	test("creates and delegates a pane to the CEF service", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1", url: "https://example.com" },
			"main",
		);
		await browserManager.navigate("pane-1", "https://example.com/docs", "ws-1");
		expect(nativeCalls.map(({ method }) => method)).toEqual([
			"browser.pane.create",
			"browser.pane.navigate",
			"browser.pane.navigate",
		]);
		expect(nativeCalls[0]?.params).toMatchObject({ url: "about:blank" });
		expect(nativeCalls[1]?.params).toMatchObject({
			url: "https://example.com",
		});
	});

	test("reattaches to a live pane without importing cookies or navigating", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1", url: "https://example.com/initial" },
			"window-a",
		);
		const existing = nativePanes.get("pane-1");
		if (!existing) throw new Error("expected native pane");
		Object.assign(existing, {
			url: "https://example.com/restored",
			title: "Restored page",
			canGoBack: true,
			canGoForward: true,
			zoomFactor: 1.25,
		});

		const originalImport = browserManager.importLegacyCookies;
		const importLegacyCookies = mock(async () => ({
			imported: 0,
			skipped: 0,
			keyUnavailable: false,
			snapshotAvailable: false,
		}));
		browserManager.importLegacyCookies = importLegacyCookies;
		const firstReattachCall = nativeCalls.length;
		try {
			const result = await browserManager.register(
				"pane-1",
				{
					workspaceId: "ws-1",
					url: "https://example.com/ignored",
					visible: false,
					bounds: { x: 10, y: 20, width: 640, height: 480 },
				},
				"window-a",
			);

			expect(result.pane).toMatchObject({
				url: "https://example.com/restored",
				title: "Restored page",
				canGoBack: true,
				canGoForward: true,
				zoomFactor: 1.25,
			});
			expect(browserManager.getPane("pane-1")).toMatchObject(result.pane);
			expect(
				nativeCalls.slice(firstReattachCall).map(({ method }) => method),
			).toEqual([
				"browser.pane.info",
				"browser.pane.setBounds",
				"browser.pane.setVisibility",
			]);
			expect(nativeCalls.slice(firstReattachCall)).toMatchObject([
				{ windowLabel: "window-a", params: { paneId: "pane-1" } },
				{
					windowLabel: "window-a",
					params: {
						paneId: "pane-1",
						bounds: { x: 10, y: 20, width: 640, height: 480 },
					},
				},
				{
					windowLabel: "window-a",
					params: { paneId: "pane-1", visible: false },
				},
			]);
			expect(importLegacyCookies).not.toHaveBeenCalled();
		} finally {
			browserManager.importLegacyCookies = originalImport;
		}
	});

	test("serializes concurrent registration through cookie import and initial navigation", async () => {
		let releaseCreate!: () => void;
		let signalCreateStarted!: () => void;
		const createGate = new Promise<void>((resolve) => {
			releaseCreate = resolve;
		});
		const createStarted = new Promise<void>((resolve) => {
			signalCreateStarted = resolve;
		});
		let createAttempts = 0;
		const originalCreateHook = nativeCreateHook;
		nativeCreateHook = async () => {
			if (createAttempts++ === 0) {
				signalCreateStarted();
				await createGate;
			}
		};

		let releaseImport!: () => void;
		let signalImportStarted!: () => void;
		const importGate = new Promise<void>((resolve) => {
			releaseImport = resolve;
		});
		const importStarted = new Promise<void>((resolve) => {
			signalImportStarted = resolve;
		});
		const originalImport = browserManager.importLegacyCookies;
		const importLegacyCookies = mock(async () => {
			signalImportStarted();
			await importGate;
			return {
				imported: 0,
				skipped: 0,
				keyUnavailable: false,
				snapshotAvailable: false,
			};
		});
		browserManager.importLegacyCookies = importLegacyCookies;

		let firstRegistration:
			| ReturnType<typeof browserManager.register>
			| undefined;
		let secondRegistration:
			| ReturnType<typeof browserManager.register>
			| undefined;
		try {
			firstRegistration = browserManager.register(
				"pane-1",
				{ workspaceId: "ws-1", url: "https://example.com/first" },
				"window-a",
			);
			await createStarted;
			secondRegistration = browserManager.register(
				"pane-1",
				{
					workspaceId: "ws-1",
					url: "https://example.com/second",
					visible: false,
					bounds: { x: 10, y: 20, width: 640, height: 480 },
				},
				"window-a",
			);
			await expect(
				browserManager.register("pane-1", { workspaceId: "ws-1" }, "window-b"),
			).rejects.toThrow("not owned by this renderer");
			await expect(
				browserManager.register("pane-1", { workspaceId: "ws-2" }, "window-a"),
			).rejects.toThrow("another workspace");
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
			]);

			releaseCreate();
			await importStarted;
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
			]);
			releaseImport();

			if (!firstRegistration || !secondRegistration)
				throw new Error("expected both registration promises");
			const [firstResult, secondResult] = await Promise.all([
				firstRegistration,
				secondRegistration,
			]);
			expect(firstResult.pane.url).toBe("https://example.com/first");
			expect(secondResult.pane.url).toBe("https://example.com/first");
			expect(importLegacyCookies).toHaveBeenCalledTimes(1);
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
				"browser.pane.navigate",
				"browser.pane.info",
				"browser.pane.setBounds",
				"browser.pane.setVisibility",
			]);
		} finally {
			releaseCreate();
			releaseImport();
			nativeCreateHook = originalCreateHook;
			browserManager.importLegacyCookies = originalImport;
			await firstRegistration?.catch(() => {});
			await secondRegistration?.catch(() => {});
		}
	});

	test("rejects re-registration from a different trusted window", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1" },
			"window-a",
		);
		const firstReattachCall = nativeCalls.length;

		await expect(
			browserManager.register("pane-1", { workspaceId: "ws-1" }, "window-b"),
		).rejects.toThrow("not owned by this renderer");
		expect(nativeCalls.slice(firstReattachCall)).toHaveLength(0);
	});

	test("rejects re-registration into a different workspace", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1" },
			"window-a",
		);
		const firstReattachCall = nativeCalls.length;

		await expect(
			browserManager.register("pane-1", { workspaceId: "ws-2" }, "window-a"),
		).rejects.toThrow("another workspace");
		expect(nativeCalls.slice(firstReattachCall)).toHaveLength(0);
	});

	test("recreates when Node metadata is stale but the native pane is gone", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1", url: "https://example.com/old" },
			"window-a",
		);
		nativePanes.delete("pane-1");
		const firstReattachCall = nativeCalls.length;

		const result = await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1", url: "https://example.com/recreated" },
			"window-a",
		);

		expect(result.pane.url).toBe("https://example.com/recreated");
		expect(
			nativeCalls.slice(firstReattachCall).map(({ method }) => method),
		).toEqual([
			"browser.pane.info",
			"browser.pane.create",
			"browser.pane.navigate",
		]);
	});

	test("does not recreate after an unrelated native pane-info error", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1" },
			"window-a",
		);
		const existing = nativePanes.get("pane-1");
		if (!existing) throw new Error("expected native pane");
		existing.infoError = new Error(
			"CEF did not answer browser.pane.info in time",
		);
		const firstReattachCall = nativeCalls.length;

		await expect(
			browserManager.register("pane-1", { workspaceId: "ws-1" }, "window-a"),
		).rejects.toThrow("CEF did not answer browser.pane.info in time");
		expect(
			nativeCalls.slice(firstReattachCall).map(({ method }) => method),
		).toEqual(["browser.pane.info"]);
	});

	test("waits for cookie import before the first guest navigation", async () => {
		const originalImport = browserManager.importLegacyCookies;
		let releaseImport!: () => void;
		let signalImportStarted!: () => void;
		const importGate = new Promise<void>((resolve) => {
			releaseImport = resolve;
		});
		const importStarted = new Promise<void>((resolve) => {
			signalImportStarted = resolve;
		});
		browserManager.importLegacyCookies = async () => {
			signalImportStarted();
			await importGate;
			return {
				imported: 1,
				skipped: 0,
				keyUnavailable: false,
				snapshotAvailable: true,
			};
		};
		try {
			const registration = browserManager.register(
				"pane-1",
				{ url: "https://example.com" },
				"main",
			);
			await importStarted;
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
			]);
			releaseImport();
			await registration;
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
				"browser.pane.navigate",
			]);
		} finally {
			releaseImport();
			browserManager.importLegacyCookies = originalImport;
		}
	});

	test("does not navigate after partial legacy cookie import", async () => {
		const originalImport = browserManager.importLegacyCookies;
		browserManager.importLegacyCookies = async () => ({
			imported: 1,
			skipped: 1,
			keyUnavailable: false,
			snapshotAvailable: true,
		});
		try {
			await expect(
				browserManager.register(
					"pane-1",
					{ url: "https://example.com" },
					"main",
				),
			).rejects.toThrow("initial navigation was paused");
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
				"browser.pane.destroy",
			]);
		} finally {
			browserManager.importLegacyCookies = originalImport;
		}
	});

	test("does not navigate when legacy cookie import fails", async () => {
		const originalImport = browserManager.importLegacyCookies;
		browserManager.importLegacyCookies = async () => {
			throw new Error("legacy cookie key is unavailable");
		};
		try {
			await expect(
				browserManager.register(
					"pane-1",
					{ url: "https://example.com" },
					"main",
				),
			).rejects.toThrow("legacy cookie key is unavailable");
			expect(nativeCalls.map(({ method }) => method)).toEqual([
				"browser.pane.create",
				"browser.pane.destroy",
			]);
		} finally {
			browserManager.importLegacyCookies = originalImport;
		}
	});

	test("updates pane state from scoped native browser events", async () => {
		await browserManager.register("pane-1", { workspaceId: "ws-1" }, "main");
		for (const listener of nativeEvents) {
			listener({
				name: "browser:event",
				windowLabel: "main",
				payload: {
					kind: "paneState",
					paneId: "pane-1",
					url: "https://example.com/next",
					isLoading: false,
				},
			});
			listener({
				name: "browser:event",
				windowLabel: "window-b",
				payload: {
					kind: "paneState",
					paneId: "pane-1",
					url: "https://spoofed.example/",
					isLoading: false,
				},
			});
		}
		expect(browserManager.getPane("pane-1")?.url).toBe(
			"https://example.com/next",
		);
	});

	test("keeps screenshot and evaluation on native paths", async () => {
		await browserManager.register("pane-1", {}, "main");
		expect(await browserManager.evaluateJS("pane-1", "1 + 1")).toBe(42);
		expect(await browserManager.capturePng("pane-1")).toBe("cG5n");
	});

	test("rejects cross-window pane access", async () => {
		await browserManager.register(
			"pane-1",
			{ workspaceId: "ws-1" },
			"window-a",
		);
		expect(() => browserManager.assertPaneOwner("pane-1", "window-b")).toThrow(
			"not owned",
		);
		await expect(
			browserManager.getPageInfo("pane-1", undefined, "window-b"),
		).rejects.toThrow("another trusted renderer");
	});

	test("returns agent-active pane ids only to their owning window", async () => {
		await browserManager.register(
			"pane-a",
			{ workspaceId: "ws-1" },
			"window-a",
		);
		await browserManager.register(
			"pane-b",
			{ workspaceId: "ws-1" },
			"window-b",
		);
		const sessionA = browserManager.attachCdp(
			"pane-a",
			"ws-1",
			() => {},
			() => {},
		);
		const sessionB = browserManager.attachCdp(
			"pane-b",
			"ws-1",
			() => {},
			() => {},
		);

		expect(browserManager.getAgentActivePaneIds("window-a")).toEqual([
			"pane-a",
		]);
		expect(browserManager.getAgentActivePaneIds("window-b")).toEqual([
			"pane-b",
		]);

		sessionA.detach();
		sessionB.detach();
	});

	test("queries native state before deciding that a pane is absent", async () => {
		expect(
			await browserManager.getPageInfo(
				"pane-not-created",
				undefined,
				"window-a",
			),
		).toBeNull();
		expect(nativeCalls).toMatchObject([
			{
				method: "browser.pane.info",
				windowLabel: "window-a",
				params: { paneId: "pane-not-created" },
			},
		]);
	});

	test("binds registration to the trusted caller and rejects another window", async () => {
		const callerA = createBrowserRouter().createCaller({
			senderWindow: null,
			windowLabel: "window-a",
		});
		await callerA.register({
			paneId: "pane-1",
			workspaceId: "ws-1",
			ownerLabel: "window-b",
		} as never);
		expect(browserManager.getPane("pane-1")?.workspaceId).toBe("ws-1");
		expect(nativeCalls[0]?.windowLabel).toBe("window-a");
		expect(nativeCalls[0]?.params).not.toHaveProperty("ownerLabel");

		const callerB = createBrowserRouter().createCaller({
			senderWindow: null,
			windowLabel: "window-b",
		});
		await expect(
			callerB.navigate({ paneId: "pane-1", url: "https://example.com" }),
		).rejects.toThrow("not owned");
		expect(nativeCalls).toHaveLength(1);
	});

	test("requires trusted caller context for global browser operations", async () => {
		const callerWithoutWindow = createBrowserRouter().createCaller({
			senderWindow: null,
			windowLabel: null,
		});
		await expect(
			callerWithoutWindow.setForwardableChords({ chords: ["meta+r"] }),
		).rejects.toThrow("trusted window label");
		await expect(
			callerWithoutWindow.clearBrowsingData({ type: "all" }),
		).rejects.toThrow("trusted window label");
		expect(nativeCalls).toHaveLength(0);
	});

	test("routes global browser operations with trusted window context", async () => {
		const caller = createBrowserRouter().createCaller({
			senderWindow: null,
			windowLabel: "window-a",
		});
		await caller.setForwardableChords({ chords: ["meta+r"] });
		expect(nativeCalls[0]).toMatchObject({
			method: "browser.hotkeys.setForwardableChords",
			windowLabel: "window-a",
			params: { chords: ["meta+r"] },
		});
	});
});
