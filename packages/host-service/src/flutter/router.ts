import {
	flutterActionSchema,
	flutterStartInput,
	flutterWorkspaceInput,
} from "@superset/shared/flutter";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { machineOnlyProcedure, router } from "../trpc";
import type { HostServiceContext } from "../types";

function manager(ctx: HostServiceContext) {
	if (!ctx.runtime.flutter)
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Flutter runtime unavailable",
		});
	return ctx.runtime.flutter;
}
const sessionInput = z.object({
	workspaceId: z.string(),
	sessionId: z.string(),
});
export const flutterRouter = router({
	profiles: machineOnlyProcedure
		.input(flutterWorkspaceInput)
		.query(({ ctx, input }) =>
			manager(ctx).profiles(input.workspaceId, input.activeFile),
		),
	devices: machineOnlyProcedure
		.input(flutterWorkspaceInput.extend({ profileId: z.string().optional() }))
		.query(({ ctx, input }) =>
			manager(ctx).devices(
				input.workspaceId,
				input.profileId,
				input.activeFile,
			),
		),
	status: machineOnlyProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(({ ctx, input }) => manager(ctx).snapshot(input.workspaceId)),
	start: machineOnlyProcedure
		.input(flutterStartInput)
		.mutation(({ ctx, input }) => manager(ctx).start(input)),
	control: machineOnlyProcedure
		.input(
			sessionInput.extend({
				action: flutterActionSchema,
				reason: z.enum(["manual", "save"]).default("manual"),
			}),
		)
		.mutation(({ ctx, input }) =>
			manager(ctx).control(
				input.workspaceId,
				input.sessionId,
				input.action,
				input.reason,
			),
		),
	inspector: machineOnlyProcedure
		.input(sessionInput)
		.mutation(({ ctx, input }) =>
			manager(ctx).inspector(input.workspaceId, input.sessionId),
		),
});
