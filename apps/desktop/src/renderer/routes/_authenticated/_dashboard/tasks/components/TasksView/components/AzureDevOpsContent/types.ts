import type { AppRouter as HostServiceAppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

type HostOutputs = inferRouterOutputs<HostServiceAppRouter>;

export type AzureDevOpsBoardResult = HostOutputs["azureDevOps"]["listBoard"];
export type AzureDevOpsBoardItem = AzureDevOpsBoardResult["items"][number];
export type AzureDevOpsBoardStage =
	| "backlog"
	| "implementation"
	| "homologation"
	| "review"
	| "completed";
export type AzureDevOpsBoardDisplayItem = Omit<
	AzureDevOpsBoardItem,
	"stage"
> & { stage: AzureDevOpsBoardStage };
