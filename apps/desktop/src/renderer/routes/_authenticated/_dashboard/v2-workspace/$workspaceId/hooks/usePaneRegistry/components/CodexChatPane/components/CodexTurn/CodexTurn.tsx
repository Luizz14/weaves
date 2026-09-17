import type { TurnGroup } from "@superset/chat/core";
import type { Decision, Item, UserInputAnswers } from "@superset/chat/protocol";
import { isPlanDocument, planDocument } from "@superset/chat/protocol";
import { CodexItem } from "../CodexItem/CodexItem";
import { CodexPlanCard } from "../CodexPlanCard";
import { CodexWorkLog } from "../CodexWorkLog/CodexWorkLog";

function isPendingInteraction(item: Item): boolean {
	return (
		(item.kind === "approval_request" && item.status === "pending") ||
		(item.kind === "user_input_request" && item.status === "pending")
	);
}

export function CodexTurn({
	group,
	dormant,
	onRespond,
	onAnswer,
	onImplementPlan,
}: {
	group: TurnGroup;
	dormant: boolean;
	onRespond: (id: string, decision: Decision) => Promise<void>;
	onAnswer: (id: string, answers: UserInputAnswers) => Promise<void>;
	onImplementPlan?: (plan: string) => Promise<boolean>;
}) {
	const items = group.entries.flatMap((entry) =>
		entry.kind === "item" ? [entry.item] : entry.items,
	);
	const running = group.turn?.status === "running" && !dormant;
	const finalMessage = running
		? undefined
		: items.findLast((item) => item.kind === "agent_message");
	const userItems = items.filter((item) => item.kind === "user_message");
	const pendingInteractions = items.filter(isPendingInteraction);
	const planDocuments = items.filter(isPlanDocument);
	const planIds = new Set(planDocuments.map((item) => item.id));
	const workItems = items.filter(
		(item) =>
			item.kind !== "user_message" &&
			item.id !== finalMessage?.id &&
			!planIds.has(item.id) &&
			!isPendingInteraction(item),
	);
	const startedAtMs =
		group.turn?.startedAtMs ??
		Math.min(...items.map((item) => item.startedAtMs));
	const completedAtMs =
		group.turn?.completedAtMs ??
		Math.max(...items.map((item) => item.completedAtMs ?? item.startedAtMs));

	return (
		<div className="space-y-4">
			{userItems.map((item) => (
				<CodexItem
					key={item.id}
					item={item}
					running={running}
					onRespond={onRespond}
					onAnswer={onAnswer}
				/>
			))}
			{workItems.length > 0 && (
				<CodexWorkLog
					items={workItems}
					startedAtMs={startedAtMs}
					completedAtMs={running ? undefined : completedAtMs}
					running={running}
				/>
			)}
			{planDocuments.map((item, index) => (
				<CodexPlanCard
					key={item.id}
					text={planDocument(item) ?? ""}
					running={running && !item.completedAtMs}
					{...(index === planDocuments.length - 1 && onImplementPlan
						? { onImplement: onImplementPlan }
						: {})}
				/>
			))}
			{pendingInteractions.map((item) => (
				<CodexItem
					key={item.id}
					item={item}
					running={running}
					onRespond={onRespond}
					onAnswer={onAnswer}
				/>
			))}
			{finalMessage && (
				<CodexItem
					item={finalMessage}
					running={false}
					onRespond={onRespond}
					onAnswer={onAnswer}
				/>
			)}
		</div>
	);
}
