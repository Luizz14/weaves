import { workspaces } from "@superset/local-db";
import {
	getOrdemCharacter,
	getOrdemPokedexSummary,
	type OrdemDiscoveryEvent,
	ordemDiscoveryEmitter,
	recordCharacterDiscovery,
	recordDiscoveryByBranch,
} from "@superset/shared/ordem-paranormal";
import { observable } from "@trpc/server/observable";
import { localDb } from "main/lib/local-db";
import { z } from "zod";
import { publicProcedure, router } from "..";

export const createOrdemParanormalRouter = () => {
	return router({
		getSummary: publicProcedure.query(() => {
			let activeBranches: string[] = [];
			try {
				const rows = localDb
					.select({ branch: workspaces.branch })
					.from(workspaces)
					.all();
				activeBranches = rows
					.map((r) => r.branch)
					.filter((b): b is string => typeof b === "string" && b.length > 0);
			} catch {
				// In case table or localDb is unavailable
			}

			return getOrdemPokedexSummary(activeBranches);
		}),

		getCharacter: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }) => {
				return getOrdemCharacter(input.id) ?? null;
			}),

		recordDiscovery: publicProcedure
			.input(
				z.object({
					characterId: z.string(),
					branch: z.string(),
					project: z.string().optional(),
					org: z.string().optional(),
				}),
			)
			.mutation(({ input }) => {
				return recordCharacterDiscovery(input.characterId, {
					branch: input.branch,
					project: input.project,
					org: input.org,
				});
			}),

		recordDiscoveryByBranch: publicProcedure
			.input(
				z.object({
					branch: z.string(),
					project: z.string().optional(),
					org: z.string().optional(),
				}),
			)
			.mutation(({ input }) => {
				return recordDiscoveryByBranch(input.branch, {
					project: input.project,
					org: input.org,
				});
			}),

		onDiscovery: publicProcedure.subscription(() => {
			return observable<OrdemDiscoveryEvent>((emit) => {
				const handler = (event: OrdemDiscoveryEvent) => {
					emit.next(event);
				};
				ordemDiscoveryEmitter.on("discovery", handler);
				return () => {
					ordemDiscoveryEmitter.off("discovery", handler);
				};
			});
		}),

		triggerTestReveal: publicProcedure
			.input(z.object({ characterId: z.string().optional() }).optional())
			.mutation(({ input }) => {
				const id = input?.characterId ?? "arthur-cervero";
				const char = getOrdemCharacter(id);
				if (!char) return null;
				const fakeEntry = {
					slug: char.id,
					firstDiscoveredAt: new Date().toISOString(),
					lastSeenAt: new Date().toISOString(),
					timesUsed: 1,
					appearances: [
						{ branch: char.id, discoveredAt: new Date().toISOString() },
					],
				};
				ordemDiscoveryEmitter.emit("discovery", {
					character: char,
					entry: fakeEntry,
					isFirstDiscovery: true,
				});
				return char;
			}),
	});
};
