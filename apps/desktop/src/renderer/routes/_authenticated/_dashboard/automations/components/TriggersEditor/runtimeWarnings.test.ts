import { describe, expect, test } from "bun:test";
import { collectRuntimeWarnings } from "./runtimeWarnings";

const CHANNELS = {
	slack: {
		channels: [
			{ id: "C1", label: "#general", botMember: true },
			{ id: "C2", label: "#secret", botMember: false },
		],
	},
};

const slackRow = (ids: string[], id = "t1") => ({
	id,
	config: {
		kind: "slack" as const,
		event: "message_in_channel",
		messageFilter: null,
		actor: { mode: "any" },
		channels: { mode: "list", ids },
		completionReaction: "white_check_mark",
	},
});

const teamsRow = {
	id: "t9",
	config: {
		kind: "microsoft_teams" as const,
		event: "channel_message",
		teams: { mode: "any" },
		channels: { mode: "any" },
		actor: { mode: "any" },
		messageFilter: null,
	},
};

describe("provider runtime warnings", () => {
	test("does not warn for a configured Slack channel", () => {
		expect(
			collectRuntimeWarnings([slackRow(["C1"])] as never, CHANNELS),
		).toEqual([]);
	});

	test("warns when the bot is not in a selected channel", () => {
		expect(
			collectRuntimeWarnings([slackRow(["C2"])] as never, CHANNELS),
		).toEqual([
			"This trigger will not run for messages in #secret until @Superset is invited.",
		]);
	});

	test("keeps each distinct warning once, independent of plan", () => {
		const warnings = collectRuntimeWarnings(
			[slackRow(["C2"], "t1"), slackRow(["C2"], "t2"), teamsRow] as never,
			CHANNELS,
		);
		expect(warnings).toEqual([
			"This trigger will not run for messages in #secret until @Superset is invited.",
		]);
	});
});
