import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

export type HistoryCommit =
	inferRouterOutputs<AppRouter>["git"]["history"]["list"]["commits"][number];
