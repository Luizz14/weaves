import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import type { NativeEvent, NativeWindowHandle } from "main/native/platform";

type NativeNotificationEventListener = (event: NativeEvent) => void;
type NativeCall = {
	method: string;
	params: unknown;
	timeoutMs: number | null | undefined;
};

const nativeEventListeners = new Map<string, NativeNotificationEventListener>();
const nativeCalls: NativeCall[] = [];
const notificationsEmitter = new EventEmitter();
let resolveNativeNotification: ((result: unknown) => void) | undefined;
let resolveNativeShowCalled: (() => void) | undefined;
const nativeShowCalled = new Promise<void>((resolve) => {
	resolveNativeShowCalled = resolve;
});

async function invokeNative<T>(
	method: string,
	params?: unknown,
	timeoutMs?: number | null,
): Promise<T> {
	nativeCalls.push({ method, params, timeoutMs });
	if (method === "notification.isSupported") return true as T;
	if (method === "notification.show") {
		resolveNativeShowCalled?.();
		return (await new Promise<unknown>((resolve) => {
			resolveNativeNotification = resolve;
		})) as T;
	}
	throw new Error(`Unexpected native method: ${method}`);
}

mock.module("main/native/platform", () => ({
	invokeNative,
	onNativeEventNamed: (
		name: string,
		listener: NativeNotificationEventListener,
	) => {
		nativeEventListeners.set(name, listener);
		return () => nativeEventListeners.delete(name);
	},
}));

mock.module("main/lib/notifications/server", () => ({
	notificationsEmitter,
}));

const { createNotificationsRouter } = await import("./notifications");

describe("notifications native bridge", () => {
	it("correlates native IDs and replays click/close events received before the show response", async () => {
		const windowActions: string[] = [];
		const windowHandle = {
			isMinimized: () => true,
			restore: () => {
				windowActions.push("restore");
			},
			show: () => {
				windowActions.push("show");
			},
			focus: () => {
				windowActions.push("focus");
			},
		} as unknown as NativeWindowHandle;
		const focusedSources: unknown[] = [];
		const focusEvent = "focus-v2-notification-source";
		const recordFocusedSource = (source: unknown) =>
			focusedSources.push(source);
		notificationsEmitter.on(focusEvent, recordFocusedSource);

		const caller = createNotificationsRouter(() => windowHandle).createCaller(
			{} as never,
		);
		const clickTarget = {
			workspaceId: "workspace-1",
			source: { type: "chat" as const, id: "chat-1" },
		};
		const resultPromise = caller.showNative({
			title: "Agent finished",
			body: "The task is ready.",
			silent: true,
			clickTarget,
		});

		await nativeShowCalled;
		if (!resolveNativeNotification) {
			throw new Error("notification.show was not invoked");
		}

		const id = "superset.native.42.7";
		const clickListener = nativeEventListeners.get("notification:click");
		const closedListener = nativeEventListeners.get("notification:closed");
		if (!clickListener || !closedListener) {
			throw new Error(
				"native notification lifecycle listeners were not attached",
			);
		}
		clickListener({ name: "notification:click", payload: { id: 7 } });
		clickListener({ name: "notification:click", payload: { id } });
		resolveNativeNotification({ id });

		expect(await resultPromise).toEqual({ success: true });
		expect(nativeCalls).toEqual([
			{
				method: "notification.isSupported",
				params: undefined,
				timeoutMs: undefined,
			},
			{
				method: "notification.show",
				params: {
					title: "Agent finished",
					subtitle: undefined,
					body: "The task is ready.",
					silent: true,
					clickTarget,
				},
				timeoutMs: null,
			},
		]);
		expect(windowActions).toEqual(["restore", "show", "focus"]);
		expect(focusedSources).toEqual([clickTarget]);

		closedListener({ name: "notification:closed", payload: { id: 42 } });
		clickListener({ name: "notification:click", payload: { id } });
		expect(windowActions).toEqual([
			"restore",
			"show",
			"focus",
			"restore",
			"show",
			"focus",
		]);
		expect(focusedSources).toEqual([clickTarget, clickTarget]);

		closedListener({ name: "notification:closed", payload: { id } });
		clickListener({ name: "notification:click", payload: { id } });
		expect(windowActions).toEqual([
			"restore",
			"show",
			"focus",
			"restore",
			"show",
			"focus",
		]);
		expect(focusedSources).toEqual([clickTarget, clickTarget]);

		notificationsEmitter.off(focusEvent, recordFocusedSource);
	});
});
