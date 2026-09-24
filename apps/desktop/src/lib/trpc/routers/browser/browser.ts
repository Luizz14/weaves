import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import {
	type BrowserOpenRequest,
	browserManager,
} from "main/lib/browser/browser-manager";
import { screenshotManager } from "main/lib/browser/screenshot-manager";
import type { ForwardedKey } from "shared/hotkey-chord";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const browserPaneProcedure = publicProcedure.use(
	async ({ ctx, input, getRawInput, next }) => {
		const procedureInput = input ?? (await getRawInput());
		if (
			procedureInput &&
			typeof procedureInput === "object" &&
			"paneId" in procedureInput
		) {
			if (!ctx.windowLabel) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Browser caller has no trusted window label",
				});
			}
			browserManager.assertPaneOwner(
				String((procedureInput as { paneId: unknown }).paneId),
				ctx.windowLabel,
			);
		}
		return next();
	},
);

function requireBrowserWindowLabel(
	windowLabel: string | null | undefined,
): string {
	if (!windowLabel) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Browser caller has no trusted window label",
		});
	}
	return windowLabel;
}

export const createBrowserRouter = () => {
	return router({
		register: publicProcedure
			.input(
				z.object({
					paneId: z.string(),
					workspaceId: z.string().optional(),
					url: z.string().optional(),
					visible: z.boolean().optional(),
					bounds: z
						.object({
							x: z.number(),
							y: z.number(),
							width: z.number(),
							height: z.number(),
						})
						.optional(),
				}),
			)
			.mutation(({ input, ctx }) =>
				browserManager.register(
					input.paneId,
					{
						workspaceId: input.workspaceId,
						url: input.url,
						visible: input.visible,
						bounds: input.bounds,
					},
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		setBounds: browserPaneProcedure
			.input(
				z.object({
					paneId: z.string(),
					bounds: z.object({
						x: z.number(),
						y: z.number(),
						width: z.number(),
						height: z.number(),
					}),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await browserManager.setBounds(
					input.paneId,
					input.bounds,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		setVisibility: browserPaneProcedure
			.input(z.object({ paneId: z.string(), visible: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.setVisibility(
					input.paneId,
					input.visible,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		unregister: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(({ input, ctx }) =>
				browserManager.unregister(
					input.paneId,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		navigate: browserPaneProcedure
			.input(z.object({ paneId: z.string(), url: z.string() }))
			.mutation(({ input, ctx }) =>
				browserManager.navigate(
					input.paneId,
					input.url,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		goBack: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(({ input, ctx }) =>
				browserManager.goBack(
					input.paneId,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		goForward: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(({ input, ctx }) =>
				browserManager.goForward(
					input.paneId,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		reload: browserPaneProcedure
			.input(z.object({ paneId: z.string(), hard: z.boolean().optional() }))
			.mutation(({ input, ctx }) =>
				browserManager.reload(
					input.paneId,
					input.hard,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		screenshot: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const capture = await browserManager.screenshot(
					input.paneId,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				const saved = await screenshotManager.save(capture, capture.url);
				return { base64: saved.base64, id: saved.id };
			}),

		evaluateJS: browserPaneProcedure
			.input(z.object({ paneId: z.string(), code: z.string() }))
			.mutation(async ({ input, ctx }) => ({
				result: await browserManager.evaluateJS(
					input.paneId,
					input.code,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			})),

		designModeSet: browserPaneProcedure
			.input(z.object({ paneId: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input, ctx }) => ({
				ok: await browserManager.setDesignMode(
					input.paneId,
					input.enabled,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			})),

		designModeAwaitSelection: browserPaneProcedure
			.input(z.object({ paneId: z.string(), opId: z.string() }))
			.mutation(({ input, ctx }) => {
				requireBrowserWindowLabel(ctx.windowLabel);
				return browserManager.awaitDesignSelection(input.paneId, input.opId);
			}),

		designModeCancel: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(({ input, ctx }) => {
				browserManager.cancelDesignSelection(
					input.paneId,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		designModeScreenshot: browserPaneProcedure
			.input(
				z.object({
					paneId: z.string(),
					rect: z.object({
						x: z.number(),
						y: z.number(),
						width: z.number(),
						height: z.number(),
					}),
				}),
			)
			.mutation(async ({ input, ctx }) => ({
				screenshot: await browserManager.captureDesignScreenshot(
					input.paneId,
					input.rect,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			})),

		getConsoleLogs: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.query(({ input }) => browserManager.getConsoleLogs(input.paneId)),

		consoleStream: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable((emit) => {
					const handler = (entry: unknown) => emit.next(entry);
					browserManager.on(`console:${input.paneId}`, handler);
					return () => browserManager.off(`console:${input.paneId}`, handler);
				}),
			),

		onPaneState: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable((emit) => {
					const handler = (state: unknown) => emit.next(state);
					browserManager.on(`pane-state:${input.paneId}`, handler);
					return () =>
						browserManager.off(`pane-state:${input.paneId}`, handler);
				}),
			),

		onFoundInPage: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable<{ activeMatchOrdinal: number; matches: number }>((emit) => {
					const handler = (result: {
						activeMatchOrdinal: number;
						matches: number;
					}) => emit.next(result);
					browserManager.on(`found-in-page:${input.paneId}`, handler);
					return () =>
						browserManager.off(`found-in-page:${input.paneId}`, handler);
				}),
			),

		onNewWindow: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable<{ url: string }>((emit) => {
					const handler = (url: string) => emit.next({ url });
					browserManager.on(`new-window:${input.paneId}`, handler);
					return () =>
						browserManager.off(`new-window:${input.paneId}`, handler);
				}),
			),

		onContextMenuAction: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable<{ action: string; url: string }>((emit) => {
					const handler = (data: { action: string; url: string }) =>
						emit.next(data);
					browserManager.on(`context-menu-action:${input.paneId}`, handler);
					return () =>
						browserManager.off(`context-menu-action:${input.paneId}`, handler);
				}),
			),

		onContextMenuRequest: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable<Record<string, unknown>>((emit) => {
					const handler = (request: Record<string, unknown>) =>
						emit.next(request);
					browserManager.on(`context-menu-request:${input.paneId}`, handler);
					return () =>
						browserManager.off(`context-menu-request:${input.paneId}`, handler);
				}),
			),

		onClosePane: paneEvent("close-pane"),
		onReloadPane: paneEvent("reload-pane"),
		onPaneFocus: paneEvent("pane-focus"),

		setForwardableChords: publicProcedure
			.input(z.object({ chords: z.array(z.string()) }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.setForwardableChords(
					input.chords,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		onKeyForward: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.subscription(({ input }) =>
				observable<ForwardedKey>((emit) => {
					const handler = (key: ForwardedKey) => emit.next(key);
					browserManager.on(`key-forward:${input.paneId}`, handler);
					return () =>
						browserManager.off(`key-forward:${input.paneId}`, handler);
				}),
			),

		onHostKeyForward: publicProcedure.subscription(({ ctx }) => {
			requireBrowserWindowLabel(ctx.windowLabel);
			return observable<ForwardedKey>((emit) => {
				const handler = (key: ForwardedKey) => emit.next(key);
				browserManager.on("host-key-forward", handler);
				return () => browserManager.off("host-key-forward", handler);
			});
		}),

		onOpenRequest: publicProcedure.subscription(({ ctx }) => {
			requireBrowserWindowLabel(ctx.windowLabel);
			return observable<BrowserOpenRequest>((emit) => {
				const handler = (request: BrowserOpenRequest) => emit.next(request);
				browserManager.on("open-request", handler);
				return () => browserManager.off("open-request", handler);
			});
		}),

		onAgentActivePanes: publicProcedure.subscription(({ ctx }) => {
			const ownerLabel = requireBrowserWindowLabel(ctx.windowLabel);
			return observable<{ paneIds: string[] }>((emit) => {
				const handler = () =>
					emit.next({
						paneIds: browserManager.getAgentActivePaneIds(ownerLabel),
					});
				browserManager.on("agent-active", handler);
				handler();
				return () => browserManager.off("agent-active", handler);
			});
		}),

		openDevTools: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.openDevTools(
					input.paneId,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		getPageInfo: publicProcedure
			.input(z.object({ paneId: z.string() }))
			.query(({ input, ctx }) =>
				browserManager.getPageInfo(
					input.paneId,
					undefined,
					requireBrowserWindowLabel(ctx.windowLabel),
				),
			),

		clearBrowsingData: publicProcedure
			.input(z.object({ type: z.enum(["cookies", "cache", "storage", "all"]) }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.clearBrowsingData(
					input.type,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		setDeviceEmulation: browserPaneProcedure
			.input(
				z.object({
					paneId: z.string(),
					params: z
						.object({ width: z.number(), height: z.number() })
						.nullable(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await browserManager.setDeviceEmulation(
					input.paneId,
					input.params,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		findInPage: browserPaneProcedure
			.input(
				z.object({
					paneId: z.string(),
					text: z.string(),
					forward: z.boolean().optional(),
					findNext: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await browserManager.findInPage(
					input.paneId,
					input.text,
					input,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		stopFindInPage: browserPaneProcedure
			.input(
				z.object({
					paneId: z.string(),
					action: z.enum([
						"clearSelection",
						"keepSelection",
						"activateSelection",
					]),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await browserManager.stopFindInPage(
					input.paneId,
					input.action,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		print: browserPaneProcedure
			.input(z.object({ paneId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.print(
					input.paneId,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		setZoom: browserPaneProcedure
			.input(z.object({ paneId: z.string(), zoomFactor: z.number() }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.setZoom(
					input.paneId,
					input.zoomFactor,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		getCookieDomains: publicProcedure.query(({ ctx }) =>
			browserManager.getCookieDomains(
				requireBrowserWindowLabel(ctx.windowLabel),
			),
		),

		clearCookiesForDomain: publicProcedure
			.input(z.object({ domain: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await browserManager.clearCookiesForDomain(
					input.domain,
					requireBrowserWindowLabel(ctx.windowLabel),
				);
				return { success: true };
			}),

		importLegacyCookies: publicProcedure.mutation(({ ctx }) =>
			browserManager.importLegacyCookies(
				requireBrowserWindowLabel(ctx.windowLabel),
			),
		),
	});
};

function paneEvent(eventName: string) {
	return browserPaneProcedure
		.input(z.object({ paneId: z.string() }))
		.subscription(({ input }) =>
			observable<void>((emit) => {
				const handler = () => emit.next();
				browserManager.on(`${eventName}:${input.paneId}`, handler);
				return () =>
					browserManager.off(`${eventName}:${input.paneId}`, handler);
			}),
		);
}
