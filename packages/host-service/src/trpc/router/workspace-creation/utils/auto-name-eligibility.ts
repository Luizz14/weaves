import { findCharacterByBranch } from "@superset/shared/ordem-paranormal";
import type { HostWorkspaceRow } from "../../../../workspaces/local-workspace-store";

/**
 * Whether agent activity may replace this workspace's display name without
 * being asked. Rows that predate `nameSource` qualify only while they still
 * show the Ordem character their branch was generated with.
 */
export function isAutoNameEligible(
	row: Pick<HostWorkspaceRow, "name" | "nameSource" | "branch" | "type">,
): boolean {
	if (row.type === "session") return false;
	if (row.nameSource === "auto") return true;
	if (row.nameSource !== null) return false;
	if (row.name !== "" && row.name !== row.branch) return false;
	return findCharacterByBranch(row.branch) !== undefined;
}
