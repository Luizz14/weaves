import { describe, expect, it } from "bun:test";
import {
	type WorkspaceLocalStateRow,
	workspaceLocalStateSchema,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { writeWorkspacePaneLayout } from "./writeWorkspacePaneLayout";

type Collections = Parameters<typeof writeWorkspacePaneLayout>[0];

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

function stubCollections(rows = new Map<string, WorkspaceLocalStateRow>()) {
	const collections = {
		v2WorkspaceLocalState: {
			state: rows,
			get: (id: string) => rows.get(id),
			insert: (row: WorkspaceLocalStateRow) => rows.set(row.workspaceId, row),
			update: (id: string, mutate: (draft: WorkspaceLocalStateRow) => void) => {
				const row = rows.get(id);
				if (row) mutate(row);
			},
		},
		v2SidebarSections: { state: new Map() },
	} as unknown as Collections;
	return { collections, rows };
}

describe("writeWorkspacePaneLayout sidebar defaults", () => {
	it("starts new project and session workspaces on Files", () => {
		for (const workspaceProjectId of [projectId, null]) {
			const { collections, rows } = stubCollections();
			writeWorkspacePaneLayout(
				collections,
				{ id: workspaceId, projectId: workspaceProjectId },
				[],
				[],
			);
			expect(rows.get(workspaceId)?.sidebarState.activeTab).toBe("files");
			expect(rows.get(workspaceId)?.sidebarState.projectId).toBe(
				workspaceProjectId,
			);
		}
	});

	it("preserves existing sidebar choices when adding launched terminals", () => {
		for (const activeTab of ["changes", "files", "review"] as const) {
			const row = workspaceLocalStateSchema.parse({
				workspaceId,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				sidebarState: { projectId, activeTab, tabOrder: 5 },
				paneLayout: { version: 1, tabs: [], activeTabId: null },
			});
			const sidebarState = { ...row.sidebarState };
			const { collections, rows } = stubCollections(
				new Map([[workspaceId, row]]),
			);
			writeWorkspacePaneLayout(
				collections,
				{ id: workspaceId, projectId },
				[{ terminalId: "term-1", label: "Workspace Setup" }],
				[],
			);
			expect(rows.get(workspaceId)?.sidebarState).toEqual(sidebarState);
			expect(rows.get(workspaceId)?.paneLayout.tabs).toHaveLength(1);
		}
	});
});
