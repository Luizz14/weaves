import { expect, test } from "bun:test";
import { Outbox } from "./outbox";

test("retry retains the options captured when the message was enqueued", async () => {
	const calls: unknown[] = [];
	let failed = true;
	const outbox = new Outbox({
		send: async (entry) => {
			calls.push(entry.execution);
			if (failed) throw Error("offline");
		},
	});
	const execution = {
		modelId: "luna",
		reasoningEffort: "medium",
		collaborationMode: "default" as const,
		fast: false,
	};
	const first = outbox.enqueue([{ type: "text", text: "hello" }], execution);
	execution.modelId = "astra";
	execution.fast = true;
	await outbox.flush();
	failed = false;
	outbox.retry(first.clientId);
	await outbox.flush();
	expect(calls).toEqual([
		{
			modelId: "luna",
			reasoningEffort: "medium",
			collaborationMode: "default",
			fast: false,
		},
		{
			modelId: "luna",
			reasoningEffort: "medium",
			collaborationMode: "default",
			fast: false,
		},
	]);
});
