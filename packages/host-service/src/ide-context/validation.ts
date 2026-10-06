import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type IdeContextSnapshot,
	ideContextSnapshotSchema,
} from "@superset/shared/ide-context";

export function isIdeContextPathInside(root: string, path: string): boolean {
	if (!isAbsolute(path)) return false;
	const child = relative(resolve(root), resolve(path));
	return (
		child !== "" &&
		child !== ".." &&
		!child.startsWith(`..${sep}`) &&
		!isAbsolute(child)
	);
}

export function validateIdeContextWorkspace(
	snapshot: IdeContextSnapshot,
	worktreePath: string,
): IdeContextSnapshot {
	const parsed = ideContextSnapshotSchema.parse(snapshot);
	const root = realpathSync(worktreePath);
	const openFiles = parsed.openFiles.filter((path) => {
		if (!isIdeContextPathInside(worktreePath, path)) return false;
		try {
			return isIdeContextPathInside(root, realpathSync(path));
		} catch {
			return false;
		}
	});
	const activeFile =
		parsed.activeFile && openFiles.includes(parsed.activeFile.path)
			? parsed.activeFile
			: null;
	if (
		activeFile &&
		!statSync(activeFile.path, { throwIfNoEntry: false })?.isFile()
	)
		activeFile.selection = null;
	return {
		...parsed,
		openFiles,
		activeFile,
		omittedFiles:
			parsed.omittedFiles + parsed.openFiles.length - openFiles.length,
	};
}
