import { describe, expect, test } from "bun:test";
import { buildGraph } from "./buildGraph";

describe("commit graph", () => {
	test("forks and joins use actual parents", () => {
		const rows = buildGraph([
			{ hash: "merge", parents: ["a", "b"] },
			{ hash: "a", parents: ["root"] },
			{ hash: "b", parents: ["root"] },
			{ hash: "root", parents: [] },
		]);
		expect(
			rows[0]?.edges.filter((edge) => edge.outgoing).map((edge) => edge.to),
		).toEqual([0, 1]);
		expect(rows[2]?.lane).toBe(1);
		expect(rows[2]?.edges).toContainEqual({
			from: 1,
			to: 0,
			incoming: false,
			outgoing: true,
		});
		expect(rows[3]?.lane).toBe(0);
		expect(rows[3]?.edges.some((edge) => edge.outgoing)).toBe(false);
	});
	test("filtered-out parents end in a stub, never a false connection", () => {
		const rows = buildGraph([
			{ hash: "tip", parents: ["hidden"] },
			{ hash: "unrelated", parents: [] },
		]);
		expect(rows[0]?.edges[0]?.missing).toBe(true);
		expect(rows[1]?.edges).toEqual([]);
	});
});
