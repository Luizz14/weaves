import type { ToolContent } from "@superset/chat/protocol";
import { diffLines } from "diff";
import type { FileDiffLine } from "renderer/components/agents/file-diff";

export function toDiffLines(
	content: Extract<ToolContent, { type: "diff" }>,
): FileDiffLine[] {
	let oldLine = 1;
	let newLine = 1;
	const lines: FileDiffLine[] = [];
	for (const change of diffLines(content.oldText ?? "", content.newText)) {
		const values = change.value.split("\n");
		if (values.at(-1) === "") values.pop();
		for (const value of values) {
			lines.push({
				id: String(lines.length),
				content: value,
				type: change.added ? "added" : change.removed ? "removed" : "context",
				...(change.added ? {} : { oldLine: oldLine++ }),
				...(change.removed ? {} : { newLine: newLine++ }),
			});
		}
	}
	return lines;
}
