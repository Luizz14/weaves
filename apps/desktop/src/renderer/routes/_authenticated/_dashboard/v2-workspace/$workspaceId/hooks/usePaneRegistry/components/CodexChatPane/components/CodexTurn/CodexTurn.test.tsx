import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TurnGroup } from "@superset/chat/core";
import type { Item } from "@superset/chat/protocol";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { render, cleanup, fireEvent, act } = await import(
	"@testing-library/react"
);
const { CodexTurn } = await import("./CodexTurn");

afterEach(cleanup);

function group(items: Item[]): TurnGroup {
	return {
		turnId: "turn-1",
		turn: {
			id: "turn-1",
			status: "completed",
			startedAtMs: 0,
			completedAtMs: 1000,
		} as TurnGroup["turn"],
		entries: items.map((item) => ({ kind: "item" as const, item })),
	};
}

const plan: Item = {
	id: "plan-1",
	kind: "plan",
	startedAtMs: 0,
	completedAtMs: 500,
	entries: [],
	text: "## Step one\n\nAdd the screen",
};

test("a plan document is shown outside the collapsed work log", () => {
	const reasoning: Item = {
		id: "reasoning-1",
		kind: "reasoning",
		startedAtMs: 0,
		completedAtMs: 400,
		text: "Considering the options",
	};
	const view = render(
		<CodexTurn
			dormant={false}
			group={group([reasoning, plan])}
			onAnswer={async () => undefined}
			onRespond={async () => undefined}
		/>,
	);

	expect(view.getByText("Add the screen")).toBeDefined();
	expect(view.queryByText("Considering the options")).toBeNull();
});

test("implementing a plan hands the whole document to the goal", async () => {
	const onImplementPlan = mock(async () => true);
	const view = render(
		<CodexTurn
			dormant={false}
			group={group([plan])}
			onAnswer={async () => undefined}
			onImplementPlan={onImplementPlan}
			onRespond={async () => undefined}
		/>,
	);

	await act(async () => {
		fireEvent.click(view.getByText("Implement plan"));
	});

	expect(onImplementPlan).toHaveBeenCalledWith(plan.text);
});

test("a plan checklist stays inside the work log", () => {
	const checklist: Item = {
		id: "plan-2",
		kind: "plan",
		startedAtMs: 0,
		completedAtMs: 500,
		entries: [{ text: "Wire the route", status: "completed" }],
	};
	const view = render(
		<CodexTurn
			dormant={false}
			group={group([checklist])}
			onAnswer={async () => undefined}
			onRespond={async () => undefined}
		/>,
	);

	expect(view.queryByText("Wire the route")).toBeNull();
});
