import { LSP_SERVER_IDS, lspSettingsSchema } from "@superset/shared/lsp";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { readLspSettings, writeLspSettings } from "../../../lsp/settings";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

function sessions(ctx: HostServiceContext) {
	if (!ctx.runtime.lsp)
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Language servers unavailable",
		});
	return ctx.runtime.lsp;
}

export const lspRouter = router({
	resolve: protectedProcedure
		.input(
			z.object({ workspaceId: z.string(), absolutePath: z.string().max(4096) }),
		)
		.mutation(({ ctx, input }) =>
			sessions(ctx).resolve(input.workspaceId, input.absolutePath),
		),
	status: protectedProcedure.query(({ ctx }) => sessions(ctx).status()),
	availability: protectedProcedure.query(({ ctx }) =>
		sessions(ctx).availability(),
	),
	restart: protectedProcedure
		.input(z.object({ serverId: z.enum(LSP_SERVER_IDS) }))
		.mutation(({ ctx, input }) => sessions(ctx).restart(input.serverId)),
	release: protectedProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(({ ctx, input }) => sessions(ctx).stop(input.sessionId)),
});

export const lspSettingsRouter = router({
	get: protectedProcedure.query(({ ctx }) => readLspSettings(ctx.db)),
	set: protectedProcedure
		.input(lspSettingsSchema)
		.mutation(async ({ ctx, input }) => {
			const previous = readLspSettings(ctx.db);
			writeLspSettings(ctx.db, input);
			await Promise.all(
				LSP_SERVER_IDS.filter(
					(id) =>
						JSON.stringify(previous.servers[id]) !==
						JSON.stringify(input.servers[id]),
				).map((serverId) => sessions(ctx).restart(serverId)),
			);
			return input;
		}),
});
