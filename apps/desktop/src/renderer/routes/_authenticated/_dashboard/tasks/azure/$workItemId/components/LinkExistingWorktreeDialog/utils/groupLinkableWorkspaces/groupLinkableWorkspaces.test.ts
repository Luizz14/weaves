import { describe, expect, it } from "bun:test";
import {
	groupLinkableWorkspaces,
	type LinkableWorkspace,
} from "./groupLinkableWorkspaces";

const ws = (
	id: string,
	projectId: string | null,
	linkedTo: string | null = null,
): LinkableWorkspace => ({
	id,
	name: id,
	branch: `feature/${id}`,
	projectId,
	externalWorkItemProvider: linkedTo ? "azure-devops" : null,
	externalWorkItemId: linkedTo,
});

const names: Record<string, string> = { api: "Api", web: "Web" };
const projectName = (id: string | null) => (id ? (names[id] ?? id) : "None");

describe("groupLinkableWorkspaces", () => {
	it("groups by project and skips workspaces already on this item", () => {
		const groups = groupLinkableWorkspaces(
			[ws("a", "web"), ws("b", "api", "42"), ws("c", "api", "7")],
			"42",
			"",
			projectName,
		);
		expect(
			groups.map((g) => [g.projectName, g.workspaces.map((w) => w.id)]),
		).toEqual([
			["Api", ["c"]],
			["Web", ["a"]],
		]);
	});

	it("filters by name, branch or project", () => {
		const all = [ws("login", "web"), ws("billing", "api")];
		expect(
			groupLinkableWorkspaces(all, "1", "api", projectName)[0]?.workspaces.map(
				(w) => w.id,
			),
		).toEqual(["billing"]);
		expect(
			groupLinkableWorkspaces(all, "1", "feature/log", projectName),
		).toHaveLength(1);
	});
});
