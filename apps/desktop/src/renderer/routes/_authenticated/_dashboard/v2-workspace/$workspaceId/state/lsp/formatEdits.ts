import { ChangeSet, Text } from "@codemirror/state";
import type { TextEdit } from "vscode-languageserver-protocol";

export function applyFormatEdits(
	content: string,
	edits: readonly TextEdit[],
): string {
	const document = Text.of(content.split("\n"));
	const offset = (position: { line: number; character: number }) => {
		if (position.line < 0 || position.line >= document.lines)
			throw new Error("Invalid formatter line");
		const line = document.line(position.line + 1);
		if (position.character < 0 || position.character > line.length)
			throw new Error("Invalid formatter column");
		return line.from + position.character;
	};
	return ChangeSet.of(
		edits
			.map((edit) => ({
				from: offset(edit.range.start),
				to: offset(edit.range.end),
				insert: edit.newText,
			}))
			.sort((a, b) => a.from - b.from),
		document.length,
	)
		.apply(document)
		.toString();
}
