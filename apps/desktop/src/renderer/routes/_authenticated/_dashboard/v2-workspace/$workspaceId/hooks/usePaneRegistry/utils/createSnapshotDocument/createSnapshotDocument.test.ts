import { describe, expect, test } from "bun:test";
import { createSnapshotDocument } from "./createSnapshotDocument";

describe("createSnapshotDocument", () => {
	test("text snapshots are immutable and isolated by revision", async () => {
		const source = { workspaceId: "ws", absolutePath: "/repo/a.ts" };
		const first = createSnapshotDocument({
			...source,
			content: { kind: "text", value: "old", revision: "one" },
		});
		const second = createSnapshotDocument({
			...source,
			content: { kind: "text", value: "new", revision: "two" },
		});
		expect(first.id).not.toBe(second.id);
		expect(first.isBinary).toBe(false);
		first.setContent("edit");
		expect(first.content).toEqual({
			kind: "text",
			value: "old",
			revision: "one",
		});
		await expect(first.save()).rejects.toThrow("read-only");
	});
	test("exposes bytes as a binary document with a size", () => {
		const doc = createSnapshotDocument({
			workspaceId: "ws",
			absolutePath: "/repo/a.png",
			content: { kind: "bytes", value: new Uint8Array(3), revision: "r1" },
		});
		expect(doc.isBinary).toBe(true);
		expect(doc.byteSize).toBe(3);
		expect(doc.dirty).toBe(false);
	});

	test("refuses to save and never notifies subscribers", async () => {
		const doc = createSnapshotDocument({
			workspaceId: "ws",
			absolutePath: "/repo/a.png",
			content: { kind: "loading" },
		});
		expect(doc.byteSize).toBeNull();
		await expect(doc.save()).rejects.toThrow("read-only");
		expect(doc.getVersion()).toBe(0);
		expect(typeof doc.subscribe(() => {})).toBe("function");
	});
});
