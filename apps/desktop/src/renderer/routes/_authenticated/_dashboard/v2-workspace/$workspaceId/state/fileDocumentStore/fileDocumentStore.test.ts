import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
	__resetDocumentStoreForTesting,
	acquireDocument,
	getDocument,
	observeDocumentSaves,
	prefetchDocument,
	releaseDocument,
	setPinnedDocuments,
} from "./fileDocumentStore";

test("a failed host save preserves the dirty document across pane reopen and explicit retry", async () => {
	let online = false;
	let writes = 0;
	const client = {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "original",
					revision: "revision-1",
					byteLength: 8,
				}),
			},
			writeFile: {
				mutate: async () => {
					writes++;
					if (!online) throw new Error("Host disconnected");
					return { ok: true, revision: "revision-2" };
				},
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2];
	const workspaceId = crypto.randomUUID();
	const path = "/workspace/reconnect.txt";
	const doc = acquireDocument(workspaceId, path, client);
	await Promise.resolve();
	expect(doc.content.kind).toBe("text");
	doc.setContent("unsaved work");
	expect((await doc.save()).status).toBe("error");
	expect(doc.saveError?.message).toBe("Host disconnected");
	expect(doc.pendingSave).toBe(false);
	expect(doc.dirty).toBe(true);
	expect(doc.content).toMatchObject({ value: "unsaved work" });
	releaseDocument(workspaceId, path);

	const reopened = acquireDocument(workspaceId, path, client);
	expect(reopened.id).toBe(doc.id);
	expect(reopened.dirty).toBe(true);
	online = true;
	expect(writes).toBe(1);
	expect((await reopened.save()).status).toBe("saved");
	expect(reopened.dirty).toBe(false);
	expect(reopened.saveError).toBeNull();
	expect(reopened.content).toMatchObject({ value: "unsaved work" });
	expect(writes).toBe(2);
	releaseDocument(workspaceId, path);
});

function fakeDisk(initial: { content: string; revision: string }) {
	const disk = { ...initial, missing: false, reads: 0 };
	const client = {
		filesystem: {
			readFile: {
				query: async () => {
					disk.reads++;
					if (disk.missing) throw new Error("ENOENT: no such file");
					return {
						kind: "text",
						content: disk.content,
						revision: disk.revision,
						byteLength: disk.content.length,
					};
				},
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2];
	return { disk, client };
}

async function settle() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
	setSystemTime();
	__resetDocumentStoreForTesting();
});

test("a released document reopens with its text on the first render", async () => {
	const { disk, client } = fakeDisk({ content: "a", revision: "1" });
	const workspaceId = crypto.randomUUID();
	const first = acquireDocument(workspaceId, "/w/a.ts", client);
	await settle();
	releaseDocument(workspaceId, "/w/a.ts");
	const again = acquireDocument(workspaceId, "/w/a.ts", client);
	expect(again.id).toBe(first.id);
	expect(again.content).toMatchObject({ kind: "text", value: "a" });
	await settle();
	expect(disk.reads).toBe(2);
	expect(again.content).toMatchObject({ value: "a", revision: "1" });
});

test("reopening picks up a file changed while it was retained", async () => {
	const { disk, client } = fakeDisk({ content: "a", revision: "1" });
	const workspaceId = crypto.randomUUID();
	acquireDocument(workspaceId, "/w/a.ts", client);
	await settle();
	releaseDocument(workspaceId, "/w/a.ts");
	disk.content = "b";
	disk.revision = "2";
	const again = acquireDocument(workspaceId, "/w/a.ts", client);
	expect(again.content).toMatchObject({ value: "a" });
	await settle();
	expect(again.content).toMatchObject({ value: "b", revision: "2" });
	expect(again.dirty).toBe(false);
});

test("an edit made while revalidating is kept and flagged", async () => {
	const { disk, client } = fakeDisk({ content: "a", revision: "1" });
	const workspaceId = crypto.randomUUID();
	acquireDocument(workspaceId, "/w/a.ts", client);
	await settle();
	releaseDocument(workspaceId, "/w/a.ts");
	disk.content = "b";
	disk.revision = "2";
	const again = acquireDocument(workspaceId, "/w/a.ts", client);
	again.setContent("typed");
	await settle();
	expect(again.content).toMatchObject({ value: "typed" });
	expect(again.hasExternalChange).toBe(true);
});

test("a file deleted while retained keeps its text and becomes orphaned", async () => {
	const { disk, client } = fakeDisk({ content: "a", revision: "1" });
	const workspaceId = crypto.randomUUID();
	acquireDocument(workspaceId, "/w/a.ts", client);
	await settle();
	releaseDocument(workspaceId, "/w/a.ts");
	disk.missing = true;
	const again = acquireDocument(workspaceId, "/w/a.ts", client);
	await settle();
	expect(again.content).toMatchObject({ value: "a" });
	expect(again.orphaned).toBe(true);
});

test("retained documents expire unless their tab is still open", async () => {
	const { client } = fakeDisk({ content: "a", revision: "1" });
	const workspaceId = crypto.randomUUID();
	setSystemTime(new Date("2026-10-09T12:00:00Z"));
	for (const path of ["/w/open.ts", "/w/closed.ts"]) {
		acquireDocument(workspaceId, path, client);
		await settle();
		releaseDocument(workspaceId, path);
	}
	setPinnedDocuments(workspaceId, ["/w/open.ts"]);
	setSystemTime(new Date("2026-10-09T12:11:00Z"));
	acquireDocument(workspaceId, "/w/other.ts", client);
	expect(getDocument(workspaceId, "/w/open.ts")).not.toBeNull();
	expect(getDocument(workspaceId, "/w/closed.ts")).toBeNull();
});

test("reacquiring with a new host client uses it for later reads", async () => {
	const workspaceId = crypto.randomUUID();
	const old = fakeDisk({ content: "a", revision: "1" });
	acquireDocument(workspaceId, "/w/a.ts", old.client);
	await settle();
	releaseDocument(workspaceId, "/w/a.ts");
	const fresh = fakeDisk({ content: "a", revision: "1" });
	acquireDocument(workspaceId, "/w/a.ts", fresh.client);
	await settle();
	expect(old.disk.reads).toBe(1);
	expect(fresh.disk.reads).toBe(1);
});

test("a prefetched document opens with its text and expires if never opened", async () => {
	const { disk, client } = fakeDisk({ content: "a", revision: "1" });
	const workspaceId = crypto.randomUUID();
	setSystemTime(new Date("2026-10-09T12:00:00Z"));
	prefetchDocument(workspaceId, "/w/opened.ts", client);
	prefetchDocument(workspaceId, "/w/opened.ts", client);
	prefetchDocument(workspaceId, "/w/skipped.ts", client);
	await settle();
	expect(disk.reads).toBe(2);
	const opened = acquireDocument(workspaceId, "/w/opened.ts", client);
	expect(opened.content).toMatchObject({ kind: "text", value: "a" });
	setSystemTime(new Date("2026-10-09T12:11:00Z"));
	acquireDocument(workspaceId, "/w/other.ts", client);
	expect(getDocument(workspaceId, "/w/opened.ts")).not.toBeNull();
	expect(getDocument(workspaceId, "/w/skipped.ts")).toBeNull();
});

test("a prefetch that fails to read leaves nothing behind", async () => {
	const { disk, client } = fakeDisk({ content: "a", revision: "1" });
	disk.missing = true;
	const workspaceId = crypto.randomUUID();
	prefetchDocument(workspaceId, "/w/gone.ts", client);
	await settle();
	expect(getDocument(workspaceId, "/w/gone.ts")).toBeNull();
});

test("save observers distinguish manual, autosave and Flutter saves and report failures", async () => {
	const events: Array<{ origin: string; phase: string; status?: string }> = [];
	let fail = false;
	const client = {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text",
					content: "old",
					revision: "1",
					byteLength: 3,
				}),
			},
			writeFile: {
				mutate: async () => {
					if (fail) throw new Error("offline");
					return { ok: true, revision: "2" };
				},
			},
		},
	} as unknown as Parameters<typeof acquireDocument>[2];
	const workspaceId = crypto.randomUUID(),
		path = "/workspace/save-origin.dart";
	const document = acquireDocument(workspaceId, path, client);
	await Promise.resolve();
	const unsubscribe = observeDocumentSaves((event) => {
		if (event.document.id === document.id)
			events.push({
				origin: event.origin,
				phase: event.phase,
				status: event.result?.status,
			});
	});
	try {
		document.setContent("manual");
		await document.save();
		document.setContent("auto");
		await document.save({ origin: "autosave" });
		fail = true;
		document.setContent("flutter");
		await document.save({ origin: "flutter-action" });
		expect(events.filter((event) => event.phase === "complete")).toEqual([
			{ origin: "manual", phase: "complete", status: "saved" },
			{ origin: "autosave", phase: "complete", status: "saved" },
			{ origin: "flutter-action", phase: "complete", status: "error" },
		]);
		expect(document.dirty).toBe(true);
	} finally {
		unsubscribe();
		releaseDocument(workspaceId, path);
	}
});
