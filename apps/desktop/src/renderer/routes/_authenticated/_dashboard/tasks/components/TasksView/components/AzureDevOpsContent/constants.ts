import type { AzureDevOpsBoardStage } from "./types";

export const AZURE_BOARD_STAGES: ReadonlyArray<{
	id: AzureDevOpsBoardStage;
	accentClass: string;
}> = [
	{
		id: "backlog",
		accentClass: "bg-sky-200 dark:bg-sky-800",
	},
	{
		id: "implementation",
		accentClass: "bg-amber-200 dark:bg-amber-800",
	},
	{
		id: "homologation",
		accentClass: "bg-orange-200 dark:bg-orange-800",
	},
	{
		id: "review",
		accentClass: "bg-violet-200 dark:bg-violet-800",
	},
	{
		id: "completed",
		accentClass: "bg-emerald-200 dark:bg-emerald-800",
	},
];

const MOVES = new Set([
	"backlog:implementation",
	"implementation:homologation",
	"homologation:implementation",
	"homologation:review",
	"review:homologation",
]);

export function canMoveAzureBoardItem(
	from: AzureDevOpsBoardStage,
	to: AzureDevOpsBoardStage,
): boolean {
	return MOVES.has(`${from}:${to}`);
}
