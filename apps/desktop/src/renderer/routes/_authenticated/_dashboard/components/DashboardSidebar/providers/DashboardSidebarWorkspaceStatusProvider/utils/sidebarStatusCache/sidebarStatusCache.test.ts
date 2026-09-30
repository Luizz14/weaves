import { describe, expect, test } from "bun:test";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { SidebarStatusCache } from "./sidebarStatusCache";

const binding = (
	terminalId: string,
	workspaceId: string,
	lastEventType = "Stop",
): TerminalAgentBinding => ({
	terminalId,
	workspaceId,
	agentId: "claude",
	startedAt: 10,
	lastEventAt: 100,
	lastEventType,
});
const initial = {
	targets: [{ workspaceId: "a" }, { workspaceId: "b" }],
	bindingRowsByIndex: [[binding("ta", "a")], [binding("tb", "b")]],
	manualUnread: {},
	terminalSeenAt: {},
	activeWorkspaceId: null,
	activeDiffStats: null,
};

describe("sidebar status cache", () => {
	test("unrelated notifications do not rederive bindings or replace entries", () => {
		let reads = 0;
		const rows = Array.from({ length: 1000 }, (_, index) => [
			{
				...binding(`t${index}`, `w${index}`),
				get lastEventType() {
					reads++;
					return "Stop";
				},
			},
		]);
		const input = {
			...initial,
			targets: rows.map(([row]) => ({ workspaceId: row.workspaceId })),
			bindingRowsByIndex: rows,
		};
		const cache = new SidebarStatusCache();
		const first = cache.update(input);
		expect(reads).toBe(1000);
		const next = cache.update({
			...input,
			manualUnread: { outside: true },
			terminalSeenAt: { outside: 500 },
		});
		expect(reads).toBe(1000);
		for (const [id, entry] of first) expect(next.get(id)).toBe(entry);
	});
	test("seen markers update only their workspace and preserve attention semantics", () => {
		const cache = new SidebarStatusCache();
		const first = cache.update(initial);
		expect(first.get("a")?.status).toBe("review");
		const seen = cache.update({ ...initial, terminalSeenAt: { ta: 100 } });
		expect(seen.get("a")?.status).toBeNull();
		expect(seen.get("a")?.isUnread).toBe(false);
		expect(seen.get("b")).toBe(first.get("b"));
		const marked = cache.update({
			...initial,
			terminalSeenAt: { ta: 100 },
			manualUnread: { a: true },
		});
		expect(marked.get("a")?.status).toBe("review");
		expect(marked.get("b")).toBe(first.get("b"));
		const permission = cache.update({
			...initial,
			bindingRowsByIndex: [
				[binding("ta", "a", "PermissionRequest")],
				initial.bindingRowsByIndex[1],
			],
			terminalSeenAt: { ta: 1000 },
		});
		expect(permission.get("a")?.status).toBe("permission");
		expect(permission.get("b")).toBe(first.get("b"));
	});
	test("fresh binding data updates status and keeps equivalent snapshots stable", () => {
		const cache = new SidebarStatusCache();
		const first = cache.update(initial);
		const equivalent = cache.update({
			...initial,
			bindingRowsByIndex: initial.bindingRowsByIndex.map((rows) => [...rows]),
		});
		expect(equivalent.get("a")).toBe(first.get("a"));
		const working = cache.update({
			...initial,
			bindingRowsByIndex: [
				[binding("ta", "a", "Start")],
				initial.bindingRowsByIndex[1],
			],
		});
		expect(working.get("a")?.status).toBe("working");
		expect(working.get("b")).toBe(first.get("b"));
	});
	test("binding metadata refreshes agents even when the attention badge is unchanged", () => {
		const cache = new SidebarStatusCache();
		const first = cache.update(initial);
		const refreshed = {
			...initial.bindingRowsByIndex[0][0],
			agentSessionId: "new-session",
			subagents: [],
		};
		const next = cache.update({
			...initial,
			bindingRowsByIndex: [[refreshed], initial.bindingRowsByIndex[1]],
		});
		expect(next.get("a")?.status).toBe(first.get("a")?.status);
		expect(next.get("a")).not.toBe(first.get("a"));
		expect(next.get("a")?.bindings.get("ta")).toBe(refreshed);
		expect(next.get("b")).toBe(first.get("b"));
	});

	test("terminal removal clears the badge without disturbing another workspace", () => {
		const cache = new SidebarStatusCache();
		const first = cache.update(initial);
		const next = cache.update({
			...initial,
			bindingRowsByIndex: [[], initial.bindingRowsByIndex[1]],
		});
		expect(next.get("a")?.bindings.size).toBe(0);
		expect(next.get("a")?.status).toBeNull();
		expect(next.get("b")).toBe(first.get("b"));
	});

	test("active diff stats follow activation without changing inactive status entries", () => {
		const cache = new SidebarStatusCache();
		const first = cache.update({
			...initial,
			activeWorkspaceId: "a",
			activeDiffStats: { additions: 3, deletions: 2 },
		});
		const unchanged = cache.update({
			...initial,
			activeWorkspaceId: "a",
			activeDiffStats: { additions: 3, deletions: 2 },
		});
		expect(unchanged.get("a")).toBe(first.get("a"));
		const next = cache.update({
			...initial,
			activeWorkspaceId: "b",
			activeDiffStats: { additions: 5, deletions: 1 },
		});
		expect(next.get("a")?.diffStats).toBeNull();
		expect(next.get("b")?.diffStats).toEqual({ additions: 5, deletions: 1 });
	});
	test("removing workspaces releases their cached rows and reordering targets preserves IDs", () => {
		const cache = new SidebarStatusCache();
		const first = cache.update(initial);
		const reversed = cache.update({
			...initial,
			targets: [...initial.targets].reverse(),
			bindingRowsByIndex: [...initial.bindingRowsByIndex].reverse(),
		});
		expect(reversed.get("a")).toBe(first.get("a"));
		expect(reversed.get("b")).toBe(first.get("b"));
		expect(
			cache.update({ ...initial, targets: [], bindingRowsByIndex: [] }).size,
		).toBe(0);
		expect(cache.update(initial).get("a")).not.toBe(first.get("a"));
	});
	test("missing data and empty terminal lists have stable snapshots", () => {
		const cache = new SidebarStatusCache();
		const empty = { ...initial, bindingRowsByIndex: [undefined, []] };
		const first = cache.update(empty);
		const next = cache.update({ ...empty, terminalSeenAt: { ta: 200 } });
		expect(next.get("a")).toBe(first.get("a"));
		expect(next.get("a")?.bindings.size).toBe(0);
		expect(next.get("a")?.status).toBeNull();
	});
});
