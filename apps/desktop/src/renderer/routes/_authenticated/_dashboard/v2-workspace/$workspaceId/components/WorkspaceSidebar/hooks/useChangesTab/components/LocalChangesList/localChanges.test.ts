import { expect, test } from "bun:test";
import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";
import {
	buildLocalChangeRows,
	buildLocalChanges,
	filterLocalChanges,
} from "./localChanges";

const file = (
	path: string,
	kind: "staged" | "unstaged",
	status: ChangesetFile["status"] = "modified",
): ChangesetFile => ({
	path,
	status,
	additions: kind === "staged" ? 10 : 2,
	deletions: 1,
	source: { kind },
});
test("a partially staged file appears once and defaults to its unstaged diff and stats", () => {
	const staged = file("example/lib/main.dart", "staged");
	const unstaged = file("example/lib/main.dart", "unstaged");
	const entries = buildLocalChanges([
		staged,
		unstaged,
		file("README.md", "unstaged", "untracked"),
	]);
	expect(entries.map((entry) => entry.path)).toEqual([
		"README.md",
		"example/lib/main.dart",
	]);
	expect(entries[1]).toMatchObject({
		state: "partial",
		primary: unstaged,
		staged,
		unstaged,
	});
	const stagedFilter = filterLocalChanges(entries, "staged");
	expect(stagedFilter).toHaveLength(1);
	expect(stagedFilter[0]?.primary).toBe(staged);
	expect(stagedFilter[0]?.state).toBe("partial");
	expect(filterLocalChanges(entries, "unstaged")).toHaveLength(2);
});
test("renames and deleted/binary files keep their source identity", () => {
	const renamed = {
		...file("renamed.ts", "staged", "renamed"),
		oldPath: "old.ts",
	};
	const binary = {
		...file("asset.png", "unstaged"),
		isBinary: true,
		additions: null,
		deletions: null,
	};
	const entries = buildLocalChanges([
		renamed,
		binary,
		file("deleted.ts", "staged", "deleted"),
	]);
	expect(entries.find((entry) => entry.path === "renamed.ts")?.primary).toBe(
		renamed,
	);
	expect(entries.find((entry) => entry.path === "renamed.ts")?.state).toBe(
		"staged",
	);
	expect(
		entries.find((entry) => entry.path === "asset.png")?.primary.additions,
	).toBeNull();
	expect(
		entries.find((entry) => entry.path === "deleted.ts")?.primary.status,
	).toBe("deleted");
});
test("tree collapses preserve directory rows and distinguish file/directory collisions", () => {
	const entries = buildLocalChanges([
		file("a", "staged", "deleted"),
		file("a/b/c.ts", "unstaged"),
		file("a/d.ts", "unstaged"),
		file("root.ts", "staged"),
	]);
	const rows = buildLocalChangeRows(entries, true, new Set(["a/b"]));
	expect(rows.map((row) => row.key)).toEqual([
		"file:a",
		"dir:a",
		"dir:a/b",
		"file:a/d.ts",
		"file:root.ts",
	]);
	expect(rows.find((row) => row.key === "dir:a")).toMatchObject({
		count: 2,
		depth: 0,
	});
	expect(buildLocalChangeRows(entries, false, new Set(["a"]))).toHaveLength(4);
});
