import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type IdeContextSnapshot,
	ideContextSnapshotSchema,
	truncateIdeContextText,
} from "@superset/shared/ide-context";
import { Hono } from "hono";
import { issueIdeContextToken, verifyIdeContextToken } from "./auth";
import { registerIdeContextRoutes } from "./routes";
import { IdeContextStore } from "./store";
import { validateIdeContextWorkspace } from "./validation";

const producer = "00000000-0000-4000-8000-000000000001";
const newer = "00000000-0000-4000-8000-000000000002";
function snapshot(
	sequence = 1,
	producerId = producer,
	workspaceId = "workspace-a",
): IdeContextSnapshot {
	return {
		workspaceId,
		producerId,
		sequence,
		activated: false,
		openFiles: ["/root/a.ts"],
		omittedFiles: 0,
		activeFile: null,
	};
}

describe("bounded IDE context", () => {
	it("rejects whole buffers, duplicates and encoded byte overflows", () => {
		expect(
			ideContextSnapshotSchema.safeParse({
				...snapshot(),
				content: "whole buffer",
			}).success,
		).toBe(false);
		expect(
			ideContextSnapshotSchema.safeParse({
				...snapshot(),
				openFiles: ["/root/a.ts", "/root/a.ts"],
			}).success,
		).toBe(false);
		expect(
			ideContextSnapshotSchema.safeParse({
				...snapshot(),
				openFiles: [`/${"界".repeat(2000)}`],
			}).success,
		).toBe(false);
		expect(
			ideContextSnapshotSchema.safeParse({
				...snapshot(),
				openFiles: Array.from(
					{ length: 100 },
					(_, n) => `/${n}${"x".repeat(400)}`,
				),
			}).success,
		).toBe(false);
		expect(truncateIdeContextText("a🙂b", 4)).toBe("a");
		expect(truncateIdeContextText("a🙂b", 5)).toBe("a🙂");
	});

	it("expires snapshots, refreshes only newer sequences and isolates workspaces", () => {
		let now = 0;
		const store = new IdeContextStore(() => now);
		expect(store.publish(snapshot(2))).toBe(true);
		now = 59_000;
		expect(store.publish(snapshot(1))).toBe(false);
		expect(store.read("workspace-b")).toBeNull();
		now = 60_000;
		expect(store.read("workspace-a")).toBeNull();
		store.publish(snapshot(3));
		now = 119_000;
		store.publish(snapshot(4));
		now = 120_000;
		expect(store.read("workspace-a")?.sequence).toBe(4);
		store.deleteWorkspace("workspace-a");
		expect(store.read("workspace-a")).toBeNull();
		expect(store.publish(snapshot(5))).toBe(false);
	});

	it("blocks late publishes after clear and an old producer cannot clear its successor", () => {
		const store = new IdeContextStore();
		store.publish(snapshot(1));
		expect(store.clear("workspace-a", producer, 1)).toBe(false);
		store.publish({ ...snapshot(1, newer), activated: true });
		expect(store.clear("workspace-a", producer, 99)).toBe(true);
		expect(store.publish(snapshot(100))).toBe(false);
		expect(store.read("workspace-a")?.producerId).toBe(newer);
		expect(store.clear("workspace-a", newer, 2)).toBe(true);
		expect(store.publish(snapshot(3, newer))).toBe(false);
		store.dispose();
		expect(store.read("workspace-a")).toBeNull();
	});

	it("arbitrates active windows without retiring displaced producers or passive takeover", () => {
		const store = new IdeContextStore();
		store.publish({ ...snapshot(1), activated: true });
		store.publish(snapshot(1, newer));
		expect(store.read("workspace-a")?.producerId).toBe(producer);
		store.publish({ ...snapshot(2, newer), activated: true });
		store.publish(snapshot(2));
		expect(store.read("workspace-a")?.producerId).toBe(newer);
		store.publish({ ...snapshot(3), activated: true });
		expect(store.read("workspace-a")?.producerId).toBe(producer);
		store.clear("workspace-a", producer, 4);
		expect(store.read("workspace-a")?.producerId).toBe(newer);
		store.publish({ ...snapshot(3, newer), activated: true });
		expect(store.read("workspace-a")?.sequence).toBe(3);
	});

	it("retains sequence 10 after expiry and capacity eviction and rejects sequence 9", () => {
		let now = 0;
		const store = new IdeContextStore(() => now);
		store.publish(snapshot(10));
		now = 60_001;
		expect(store.read("workspace-a")).toBeNull();
		expect(store.publish(snapshot(9))).toBe(false);
		expect(store.publish(snapshot(11))).toBe(true);
		for (let n = 0; n < 128; n++)
			store.publish(snapshot(10, producer, `capacity-${n}`));
		expect(store.read("workspace-a")).toBeNull();
		expect(store.publish(snapshot(9))).toBe(false);
		expect(store.publish(snapshot(12))).toBe(true);
		now += 120_001;
		expect(store.publish(snapshot(9))).toBe(true);
	});

	it("bounds workspace entries", () => {
		const store = new IdeContextStore();
		for (let n = 0; n < 129; n++)
			store.publish(snapshot(1, producer, `workspace-${n}`));
		expect(store.read("workspace-0")).toBeNull();
		expect(store.read("workspace-128")).not.toBeNull();
	});

	it("filters outside, missing and escaped symlinks without suppressing valid context", () => {
		const root = mkdtempSync(join(tmpdir(), "ide-context-root-"));
		const outside = mkdtempSync(join(tmpdir(), "ide-context-outside-"));
		try {
			const valid = join(root, "valid.ts");
			const external = join(outside, "external.ts");
			const link = join(root, "escape.ts");
			const missing = join(root, "missing.ts");
			writeFileSync(valid, "fixture");
			writeFileSync(external, "fixture");
			symlinkSync(external, link);
			const parsed = validateIdeContextWorkspace(
				{
					...snapshot(),
					openFiles: [valid, external, link, missing],
					activeFile: {
						path: external,
						documentId: "doc",
						version: 1,
						selection: {
							from: 0,
							to: 7,
							startLine: 1,
							endLine: 1,
							text: "fixture",
							truncated: false,
						},
					},
				},
				root,
			);
			expect(parsed.openFiles).toEqual([valid]);
			expect(parsed.omittedFiles).toBe(3);
			expect(parsed.activeFile).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("terminal-only context authorization", () => {
	it("binds token to its organization, origin workspace and terminal", () => {
		const token = issueIdeContextToken("org-a", "workspace-a", "terminal-a");
		expect(
			verifyIdeContextToken("org-a", "workspace-a", "terminal-a", token),
		).toBe(true);
		for (const [organizationId, workspaceId, terminalId] of [
			["org-b", "workspace-a", "terminal-a"],
			["org-a", "workspace-b", "terminal-a"],
			["org-a", "workspace-a", "terminal-b"],
		] as const) {
			expect(
				verifyIdeContextToken(organizationId, workspaceId, terminalId, token),
			).toBe(false);
		}
		expect(
			verifyIdeContextToken(
				"org-a",
				"workspace-a",
				"terminal-a",
				"0".repeat(64),
			),
		).toBe(false);
	});

	it("rejects a token issued by another host process after restart", () => {
		const modulePath = fileURLToPath(new URL("./auth.ts", import.meta.url));
		const result = Bun.spawnSync([
			process.execPath,
			"-e",
			`import { issueIdeContextToken } from ${JSON.stringify(modulePath)}; console.log(issueIdeContextToken('org-a', 'workspace-a', 'terminal-a'));`,
		]);
		expect(result.exitCode).toBe(0);
		const token = result.stdout.toString().trim();
		expect(token).toMatch(/^[a-f0-9]{64}$/);
		expect(
			verifyIdeContextToken("org-a", "workspace-a", "terminal-a", token),
		).toBe(false);
	});

	it("cancels an oversized body without Content-Length before terminal resolution", async () => {
		const app = new Hono();
		let resolved = false;
		let canceled = false;
		registerIdeContextRoutes({
			app,
			store: new IdeContextStore(),
			organizationId: "org-a",
			resolveTerminal: () => {
				resolved = true;
				return null;
			},
		});
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(256));
			},
			cancel() {
				canceled = true;
			},
		});
		const request = new Request("http://localhost/ide-context/terminal", {
			method: "POST",
			body,
			duplex: "half",
		} as RequestInit);
		expect(request.headers.has("content-length")).toBe(false);
		expect((await app.request(request)).status).toBe(400);
		expect(canceled).toBe(true);
		expect(resolved).toBe(false);
	});

	it("serves only a live authorized terminal and rejects arbitrary workspace reads", async () => {
		const store = new IdeContextStore();
		store.publish(snapshot());
		let live = true;
		const app = new Hono();
		registerIdeContextRoutes({
			app,
			store,
			organizationId: "org-a",
			resolveTerminal: (id) =>
				id === "terminal-a"
					? { workspaceId: "workspace-a", workspacePath: "/root", live }
					: null,
		});
		const request = (
			body: unknown,
			token = issueIdeContextToken("org-a", "workspace-a", "terminal-a"),
		) =>
			app.request("/ide-context/terminal", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(body),
			});
		const valid = await request({ terminalId: "terminal-a" });
		expect(valid.status).toBe(200);
		expect(valid.headers.get("cache-control")).toBe("no-store");
		expect(await valid.json()).toMatchObject({
			snapshot: { workspaceId: "workspace-a" },
		});
		expect((await request({ terminalId: "terminal-b" })).status).toBe(401);
		expect(
			(await request({ terminalId: "terminal-a", workspaceId: "workspace-b" }))
				.status,
		).toBe(400);
		expect(
			(
				await request(
					{ terminalId: "terminal-a" },
					issueIdeContextToken("org-b", "workspace-a", "terminal-a"),
				)
			).status,
		).toBe(401);
		live = false;
		expect((await request({ terminalId: "terminal-a" })).status).toBe(401);
		expect(
			(await request({ terminalId: "terminal-a" }, "0".repeat(64))).status,
		).toBe(401);
	});
});
