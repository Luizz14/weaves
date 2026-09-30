import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";

export type StagingFilter = "all" | "unstaged" | "staged";
export interface LocalChangeEntry {
	path: string;
	primary: ChangesetFile;
	staged?: ChangesetFile;
	unstaged?: ChangesetFile;
	state: "unstaged" | "staged" | "partial";
}
export function buildLocalChanges(files: ChangesetFile[]): LocalChangeEntry[] {
	const byPath = new Map<
		string,
		{ staged?: ChangesetFile; unstaged?: ChangesetFile }
	>();
	for (const file of files) {
		if (file.source.kind !== "staged" && file.source.kind !== "unstaged")
			continue;
		const entry = byPath.get(file.path) ?? {};
		entry[file.source.kind] = file;
		byPath.set(file.path, entry);
	}
	return [...byPath.entries()]
		.map(([path, sources]) => {
			const primary = sources.unstaged ?? sources.staged;
			if (!primary) throw new Error("Missing local change source");
			return {
				path,
				primary,
				...sources,
				state: sources.staged
					? sources.unstaged
						? ("partial" as const)
						: ("staged" as const)
					: ("unstaged" as const),
			};
		})
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export function filterLocalChanges(
	entries: LocalChangeEntry[],
	filter: StagingFilter,
): LocalChangeEntry[] {
	return entries.flatMap((entry) => {
		if (filter === "all") return [entry];
		const primary = entry[filter];
		return primary ? [{ ...entry, primary }] : [];
	});
}
export type LocalChangeRow =
	| { kind: "file"; key: string; entry: LocalChangeEntry; depth: number }
	| {
			kind: "directory";
			key: string;
			path: string;
			depth: number;
			count: number;
	  };
export function buildLocalChangeRows(
	entries: LocalChangeEntry[],
	tree: boolean,
	collapsed: Set<string>,
): LocalChangeRow[] {
	if (!tree)
		return entries.map((entry) => ({
			kind: "file",
			key: `file:${entry.path}`,
			entry,
			depth: 0,
		}));
	const directoryCounts = new Map<string, number>();
	for (const entry of entries) {
		const parts = entry.path.split("/");
		for (let index = 1; index < parts.length; index++) {
			const path = parts.slice(0, index).join("/");
			directoryCounts.set(path, (directoryCounts.get(path) ?? 0) + 1);
		}
	}
	const rows: LocalChangeRow[] = [
		...[...directoryCounts].map(([path, count]) => ({
			kind: "directory" as const,
			key: `dir:${path}`,
			path,
			depth: path.split("/").length - 1,
			count,
		})),
		...entries.map((entry) => ({
			kind: "file" as const,
			key: `file:${entry.path}`,
			entry,
			depth: entry.path.split("/").length - 1,
		})),
	];
	const sortPath = (row: LocalChangeRow) =>
		row.kind === "file" ? row.entry.path : `${row.path}/`;
	return rows
		.sort((a, b) =>
			sortPath(a) < sortPath(b) ? -1 : sortPath(a) > sortPath(b) ? 1 : 0,
		)
		.filter((row) => {
			const path = row.kind === "file" ? row.entry.path : row.path;
			return ![...collapsed].some((parent) => path.startsWith(`${parent}/`));
		});
}
