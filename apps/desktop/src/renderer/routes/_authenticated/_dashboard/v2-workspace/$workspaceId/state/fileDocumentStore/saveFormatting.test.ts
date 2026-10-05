import { expect, test } from "bun:test";
import {
	acquireDocument,
	registerSaveTransform,
	releaseDocument,
} from "./fileDocumentStore";

function setup() {
	const writes: string[] = [];
	const workspaceId = crypto.randomUUID();
	const path = "/workspace/format.ts";
	const client = {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "original",
					revision: "1",
					byteLength: 8,
				}),
			},
			writeFile: {
				mutate: async ({ content }: { content: string }) => {
					writes.push(content);
					return { ok: true, revision: "2" };
				},
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2];
	return {
		document: acquireDocument(workspaceId, path, client),
		writes,
		workspaceId,
		path,
	};
}

test("concurrent save requests share formatting and one write", async () => {
	const { document, writes, workspaceId, path } = setup();
	await Promise.resolve();
	document.setContent("unformatted");
	let requests = 0;
	const unregister = registerSaveTransform(document.id, async () => {
		requests++;
		await new Promise((resolve) => setTimeout(resolve, 10));
		return { content: "formatted" };
	});
	const results = await Promise.all([
		document.save(),
		document.save(),
		document.save(),
	]);
	expect(results.every((result) => result.status === "saved")).toBe(true);
	expect(requests).toBe(1);
	expect(writes).toEqual(["formatted"]);
	expect(document.dirty).toBe(false);
	unregister();
	releaseDocument(workspaceId, path);
});

test("formatting failure saves with a warning and stale results never replace newer edits", async () => {
	const { document, writes, workspaceId, path } = setup();
	await Promise.resolve();
	document.setContent("before");
	let unregister = registerSaveTransform(document.id, async () => {
		throw new Error("offline formatter");
	});
	expect((await document.save()).status).toBe("saved");
	expect(document.formatWarning).toBe("format-failed");
	unregister();
	document.setContent("request snapshot");
	unregister = registerSaveTransform(document.id, async () => {
		document.setContent("newer edit");
		return { content: "stale formatting" };
	});
	expect((await document.save()).status).toBe("saved");
	expect(writes.at(-1)).toBe("newer edit");
	expect(document.content).toMatchObject({ value: "newer edit" });
	unregister();
	releaseDocument(workspaceId, path);
});
