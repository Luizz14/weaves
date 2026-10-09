import {
	clearIdeContextSchema,
	ideContextSnapshotSchema,
} from "@superset/shared/ide-context";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { workspaces } from "../db/schema";
import { protectedProcedure, router } from "../trpc/index";
import { validateIdeContextWorkspace } from "./validation";

export const ideContextRouter = router({
	publish: protectedProcedure
		.input(ideContextSnapshotSchema)
		.mutation(({ ctx, input }) => {
			const workspace = ctx.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, input.workspaceId) })
				.sync();
			if (!workspace || workspace.archivedAt !== null)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			if (!ctx.runtime.ideContext) return { accepted: false };
			try {
				return {
					accepted: ctx.runtime.ideContext.publish(
						validateIdeContextWorkspace(input, workspace.worktreePath),
					),
				};
			} catch {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid IDE context snapshot",
				});
			}
		}),
	clear: protectedProcedure
		.input(clearIdeContextSchema)
		.mutation(({ ctx, input }) => ({
			cleared:
				ctx.runtime.ideContext?.clear(
					input.workspaceId,
					input.producerId,
					input.sequence,
				) ?? false,
		})),
});
