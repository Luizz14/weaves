import { describe, expect, test } from "bun:test";
import type { LinkedWorkspace, Notice } from "@superset/chat/protocol";
import type { AdapterEvent, ResolvedAttachment } from "../../types";
import type { CodexTransportHandlers } from "../rpcClient";
import { CodexAdapter } from "./codexAdapter";

const THREAD_ID = "thread-1";
const CWD = "/tmp/workspace";

type Harness = {
	adapter: CodexAdapter;
	events: AdapterEvent[];
	sent: Record<string, unknown>[];
	turnStart(index: number): Record<string, unknown>;
	settle(): Promise<void>;
};

function startAdapter(linkedWorkspaces?: LinkedWorkspace[]): Harness {
	const sent: Record<string, unknown>[] = [];
	const events: AdapterEvent[] = [];
	let handlers: CodexTransportHandlers | null = null;

	const adapter = new CodexAdapter({
		now: () => 1_785_000_000_000,
		mintId: () => "minted",
		createTransport: (_options, transportHandlers) => {
			handlers = transportHandlers;
			return {
				send: (line) => {
					const frame = JSON.parse(line) as {
						id?: number;
						method?: string;
						params?: Record<string, unknown>;
					};
					sent.push(frame);
					if (frame.method === "initialize") {
						handlers?.onLine(
							JSON.stringify({
								id: frame.id,
								result: {
									userAgent: "superset-chat-runtime/0.143.0 (Mac OS)",
								},
							}),
						);
						return;
					}
					if (
						frame.method === "thread/start" ||
						frame.method === "thread/resume"
					) {
						handlers?.onLine(
							JSON.stringify({
								id: frame.id,
								result: { thread: { id: THREAD_ID }, model: "gpt-5.5" },
							}),
						);
						return;
					}
					if (frame.method === "turn/start")
						handlers?.onLine(JSON.stringify({ id: frame.id, result: {} }));
				},
				close: async () => undefined,
			};
		},
	});

	void (async () => {
		for await (const event of adapter.start({ cwd: CWD, linkedWorkspaces })) {
			events.push(event);
		}
	})();

	return {
		adapter,
		events,
		sent,
		turnStart: (index) => {
			const frame = sent.filter((entry) => entry.method === "turn/start")[
				index
			];
			if (!frame) throw new Error(`no turn/start at ${index}`);
			return frame.params as Record<string, unknown>;
		},
		settle: async () => {
			for (let index = 0; index < 6; index += 1) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		},
	};
}

function inputTypes(turnStart: Record<string, unknown>): string[] {
	return (turnStart.input as { type: string }[]).map((item) => item.type);
}

const LINKED: LinkedWorkspace = {
	workspaceId: "workspace-2",
	name: "docs",
	branch: "main",
	path: "/tmp/docs",
};

function notices(events: AdapterEvent[]): Notice[] {
	return events.flatMap((event) =>
		event.kind === "item" && event.item.kind === "notice"
			? [event.item as Notice]
			: [],
	);
}

describe("codex linked workspaces", () => {
	test("linked workspace paths join the cwd in writableRoots", async () => {
		const harness = startAdapter();
		await harness.settle();

		await harness.adapter.setLinkedWorkspaces([LINKED]);
		harness.adapter.prompt([{ type: "text", text: "go" }]);
		await harness.settle();

		expect(harness.turnStart(0).sandboxPolicy).toMatchObject({
			type: "workspaceWrite",
			writableRoots: [CWD, "/tmp/docs"],
		});

		await harness.adapter.dispose();
	});

	test("mentions ride the first turn after a change, not every turn", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.adapter.prompt([{ type: "text", text: "first" }]);
		await harness.settle();
		expect(inputTypes(harness.turnStart(0))).toEqual(["text"]);

		await harness.adapter.setLinkedWorkspaces([LINKED]);
		harness.adapter.prompt([{ type: "text", text: "second" }]);
		await harness.settle();
		expect(harness.turnStart(1).input).toEqual([
			{ type: "mention", name: "docs", path: "/tmp/docs" },
			{ type: "text", text: "second", text_elements: [] },
		]);

		harness.adapter.prompt([{ type: "text", text: "third" }]);
		await harness.settle();
		expect(inputTypes(harness.turnStart(2))).toEqual(["text"]);

		await harness.adapter.dispose();
	});

	test("a set restored at start is mentioned on the next turn", async () => {
		const harness = startAdapter([LINKED]);
		await harness.settle();

		harness.adapter.prompt([{ type: "text", text: "go" }]);
		await harness.settle();

		expect(inputTypes(harness.turnStart(0))).toEqual(["mention", "text"]);
		expect(harness.turnStart(0).sandboxPolicy).toMatchObject({
			writableRoots: [CWD, "/tmp/docs"],
		});

		await harness.adapter.dispose();
	});
});

describe("codex attachments", () => {
	const resolved: ResolvedAttachment[] = [
		{ attachmentId: "a-1", path: "/tmp/shot.png", mimeType: "image/png" },
		{
			attachmentId: "a-2",
			path: "/tmp/report.pdf",
			mimeType: "application/pdf",
		},
	];

	test("an image becomes localImage and anything else becomes a mention", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.adapter.prompt(
			[
				{ type: "text", text: "look" },
				{
					type: "attachment",
					attachmentId: "a-1",
					name: "shot.png",
					mimeType: "image/png",
				},
				{
					type: "attachment",
					attachmentId: "a-2",
					name: "report.pdf",
					mimeType: "application/pdf",
				},
			],
			undefined,
			resolved,
		);
		await harness.settle();

		expect(harness.turnStart(0).input).toEqual([
			{ type: "text", text: "look", text_elements: [] },
			{ type: "localImage", path: "/tmp/shot.png" },
			{ type: "mention", name: "report.pdf", path: "/tmp/report.pdf" },
		]);

		await harness.adapter.dispose();
	});

	test("an attachment with no resolution becomes a notice, not a crash", async () => {
		const harness = startAdapter();
		await harness.settle();

		harness.adapter.prompt([
			{
				type: "attachment",
				attachmentId: "a-9",
				name: "ghost.txt",
				mimeType: "text/plain",
			},
		]);
		await harness.settle();

		expect(notices(harness.events).at(-1)?.text).toContain("ghost.txt");

		await harness.adapter.dispose();
	});
});
