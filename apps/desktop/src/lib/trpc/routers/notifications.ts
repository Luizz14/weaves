import { observable } from "@trpc/server/observable";
import {
	type AgentLifecycleEvent,
	type NotificationIds,
	notificationsEmitter,
} from "main/lib/notifications/server";
import {
	invokeNative,
	type NativeWindowHandle,
	onNativeEventNamed,
} from "main/native/platform";
import { NOTIFICATION_EVENTS } from "shared/constants";
import type { V2NotificationSourceFocusTarget } from "shared/notification-types";
import { z } from "zod";
import { publicProcedure, router } from "..";

type TerminalExitNotification = NotificationIds & {
	exitCode: number;
	signal?: number;
	reason?: "killed" | "exited" | "error";
};

type NotificationEvent =
	| {
			type: typeof NOTIFICATION_EVENTS.AGENT_LIFECYCLE;
			data?: AgentLifecycleEvent;
	  }
	| { type: typeof NOTIFICATION_EVENTS.FOCUS_TAB; data?: NotificationIds }
	| {
			type: typeof NOTIFICATION_EVENTS.FOCUS_V2_NOTIFICATION_SOURCE;
			data?: V2NotificationSourceFocusTarget;
	  }
	| {
			type: typeof NOTIFICATION_EVENTS.TERMINAL_EXIT;
			data?: TerminalExitNotification;
	  }
	| {
			type: typeof NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE;
			data?: { themeState?: unknown };
	  };

const v2NotificationSourceSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("terminal"), id: z.string().min(1) }),
	z.object({ type: z.literal("chat"), id: z.string().min(1) }),
]);

const showNativeInputSchema = z.object({
	title: z.string().min(1),
	subtitle: z.string().optional(),
	body: z.string(),
	silent: z.boolean().default(true),
	clickTarget: z
		.object({
			workspaceId: z.string().min(1),
			source: v2NotificationSourceSchema,
		})
		.optional(),
});
type ShowNativeInput = z.infer<typeof showNativeInputSchema>;
const nativeNotificationResultSchema = z.object({ id: z.string().min(1) });
const nativeNotificationEventSchema = z.object({ id: z.string().min(1) });

type NativeNotificationLifecycleEvent =
	| "notification:click"
	| "notification:closed";
type PendingNativeNotificationEvents = {
	events: NativeNotificationLifecycleEvent[];
	expiresAt: number;
};

const PENDING_NOTIFICATION_EVENT_TTL_MS = 60_000;
const MAX_PENDING_NOTIFICATION_EVENTS = 128;

const activeNativeNotifications = new Map<string, string>();
const notificationActions = new Map<
	string,
	{
		getWindow: () => NativeWindowHandle | null;
		clickTarget?: ShowNativeInput["clickTarget"];
	}
>();
const pendingNativeNotificationEvents = new Map<
	string,
	PendingNativeNotificationEvents
>();
let nativeNotificationCounter = 0;
let pendingNativeNotificationShows = 0;

onNativeEventNamed("notification:click", (event) => {
	const parsed = nativeNotificationEventSchema.safeParse(event.payload);
	if (!parsed.success) return;
	if (
		!notificationActions.has(parsed.data.id) &&
		pendingNativeNotificationShows === 0
	) {
		return;
	}
	handleNativeNotificationClick(parsed.data.id);
});

onNativeEventNamed("notification:closed", (event) => {
	const parsed = nativeNotificationEventSchema.safeParse(event.payload);
	if (!parsed.success) return;
	if (
		!notificationActions.has(parsed.data.id) &&
		pendingNativeNotificationShows === 0
	) {
		return;
	}
	handleNativeNotificationClosed(parsed.data.id);
});

function handleNativeNotificationClick(id: string): void {
	const action = notificationActions.get(id);
	if (!action) {
		rememberPendingNativeNotificationEvent(id, "notification:click");
		return;
	}
	focusWindow(action.getWindow);
	if (action.clickTarget) {
		notificationsEmitter.emit(
			NOTIFICATION_EVENTS.FOCUS_V2_NOTIFICATION_SOURCE,
			action.clickTarget,
		);
	}
}

function handleNativeNotificationClosed(id: string): void {
	if (!notificationActions.has(id)) {
		rememberPendingNativeNotificationEvent(id, "notification:closed");
		return;
	}
	removeNativeNotification(id);
}

function rememberPendingNativeNotificationEvent(
	id: string,
	event: NativeNotificationLifecycleEvent,
): void {
	const now = Date.now();
	for (const [pendingId, pending] of pendingNativeNotificationEvents) {
		if (pending.expiresAt <= now) {
			pendingNativeNotificationEvents.delete(pendingId);
		}
	}

	let pending = pendingNativeNotificationEvents.get(id);
	if (!pending) {
		if (
			pendingNativeNotificationEvents.size >= MAX_PENDING_NOTIFICATION_EVENTS
		) {
			const oldestId = pendingNativeNotificationEvents.keys().next().value;
			if (oldestId !== undefined) {
				pendingNativeNotificationEvents.delete(oldestId);
			}
		}
		pending = {
			events: [],
			expiresAt: now + PENDING_NOTIFICATION_EVENT_TTL_MS,
		};
		pendingNativeNotificationEvents.set(id, pending);
	}
	if (!pending.events.includes(event)) pending.events.push(event);
}

function removeNativeNotification(id: string): void {
	notificationActions.delete(id);
	for (const [key, activeId] of activeNativeNotifications) {
		if (activeId === id) activeNativeNotifications.delete(key);
	}
}

function registerNativeNotification(
	id: string,
	key: string,
	action: {
		getWindow: () => NativeWindowHandle | null;
		clickTarget?: ShowNativeInput["clickTarget"];
	},
): void {
	trackNativeNotification(key, id);
	notificationActions.set(id, action);

	const pending = pendingNativeNotificationEvents.get(id);
	if (!pending) return;
	pendingNativeNotificationEvents.delete(id);
	if (pending.expiresAt <= Date.now()) return;
	for (const event of pending.events) {
		if (event === "notification:click") {
			handleNativeNotificationClick(id);
			continue;
		}
		handleNativeNotificationClosed(id);
	}
}

function focusWindow(getWindow: () => NativeWindowHandle | null): void {
	const window = getWindow();
	if (!window) return;
	if (window.isMinimized()) {
		window.restore();
	}
	window.show();
	window.focus();
}

function getNativeNotificationKey(input: ShowNativeInput): string {
	const target = input.clickTarget;
	if (!target) return `_native_${nativeNotificationCounter++}`;
	return `${target.workspaceId}:${target.source.type}:${target.source.id}`;
}

function trackNativeNotification(key: string, notificationId: string): void {
	const previous = activeNativeNotifications.get(key);
	if (previous) {
		void invokeNative("notification.close", { id: previous }).catch((error) =>
			console.error(
				"[notifications] Failed to close native notification:",
				error,
			),
		);
	}
	activeNativeNotifications.set(key, notificationId);
}

export const createNotificationsRouter = (
	getWindow: () => NativeWindowHandle | null,
) => {
	return router({
		showNative: publicProcedure
			.input(showNativeInputSchema)
			.mutation(async ({ input }) => {
				const supported = await invokeNative<boolean>(
					"notification.isSupported",
				);
				if (!supported) {
					return { success: false as const, reason: "unsupported" as const };
				}

				pendingNativeNotificationShows++;
				let nativeResult: unknown;
				try {
					nativeResult = await invokeNative<unknown>(
						"notification.show",
						{
							title: input.title,
							subtitle: input.subtitle,
							body: input.body,
							silent: input.silent,
							clickTarget: input.clickTarget,
						},
						null,
					);
				} finally {
					pendingNativeNotificationShows--;
				}
				const notification = nativeNotificationResultSchema.parse(nativeResult);
				const key = getNativeNotificationKey(input);
				registerNativeNotification(notification.id, key, {
					getWindow,
					clickTarget: input.clickTarget,
				});
				return { success: true as const };
			}),

		setDockBadge: publicProcedure
			.input(z.object({ count: z.number().int().min(0) }))
			.mutation(async ({ input }) => {
				await invokeNative("app.setBadgeCount", { count: input.count });
				return { success: true as const };
			}),

		subscribe: publicProcedure.subscription(() => {
			return observable<NotificationEvent>((emit) => {
				const onLifecycle = (data: AgentLifecycleEvent) => {
					emit.next({ type: NOTIFICATION_EVENTS.AGENT_LIFECYCLE, data });
				};

				const onFocusTab = (data: NotificationIds) => {
					emit.next({ type: NOTIFICATION_EVENTS.FOCUS_TAB, data });
				};

				const onFocusV2NotificationSource = (
					data: V2NotificationSourceFocusTarget,
				) => {
					emit.next({
						type: NOTIFICATION_EVENTS.FOCUS_V2_NOTIFICATION_SOURCE,
						data,
					});
				};

				const onTerminalExit = (data: TerminalExitNotification) => {
					emit.next({ type: NOTIFICATION_EVENTS.TERMINAL_EXIT, data });
				};

				const onSettingsExternalChange = (data: { themeState?: unknown }) => {
					emit.next({
						type: NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE,
						data,
					});
				};

				notificationsEmitter.on(
					NOTIFICATION_EVENTS.AGENT_LIFECYCLE,
					onLifecycle,
				);
				notificationsEmitter.on(NOTIFICATION_EVENTS.FOCUS_TAB, onFocusTab);
				notificationsEmitter.on(
					NOTIFICATION_EVENTS.FOCUS_V2_NOTIFICATION_SOURCE,
					onFocusV2NotificationSource,
				);
				notificationsEmitter.on(
					NOTIFICATION_EVENTS.TERMINAL_EXIT,
					onTerminalExit,
				);
				notificationsEmitter.on(
					NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE,
					onSettingsExternalChange,
				);

				return () => {
					notificationsEmitter.off(
						NOTIFICATION_EVENTS.AGENT_LIFECYCLE,
						onLifecycle,
					);
					notificationsEmitter.off(NOTIFICATION_EVENTS.FOCUS_TAB, onFocusTab);
					notificationsEmitter.off(
						NOTIFICATION_EVENTS.FOCUS_V2_NOTIFICATION_SOURCE,
						onFocusV2NotificationSource,
					);
					notificationsEmitter.off(
						NOTIFICATION_EVENTS.TERMINAL_EXIT,
						onTerminalExit,
					);
					notificationsEmitter.off(
						NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE,
						onSettingsExternalChange,
					);
				};
			});
		}),
	});
};
