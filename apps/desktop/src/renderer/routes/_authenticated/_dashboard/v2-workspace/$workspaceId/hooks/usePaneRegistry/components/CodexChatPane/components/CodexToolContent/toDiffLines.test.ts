import { expect, test } from "bun:test";
import { toDiffLines } from "./toDiffLines";

test("preserves context and line numbers in edited files", () => {
	expect(
		toDiffLines({
			type: "diff",
			path: "file.ts",
			oldText: "same\nold\n",
			newText: "same\nnew\n",
		}),
	).toEqual([
		{ id: "0", type: "context", content: "same", oldLine: 1, newLine: 1 },
		{ id: "1", type: "removed", content: "old", oldLine: 2 },
		{ id: "2", type: "added", content: "new", newLine: 2 },
	]);
});
test("renders file creation and deletion without phantom empty lines", () => {
	expect(
		toDiffLines({
			type: "diff",
			path: "new",
			oldText: null,
			newText: "hello\n",
		}),
	).toEqual([{ id: "0", type: "added", content: "hello", newLine: 1 }]);
	expect(
		toDiffLines({
			type: "diff",
			path: "gone",
			oldText: "hello\n",
			newText: "",
		}),
	).toEqual([{ id: "0", type: "removed", content: "hello", oldLine: 1 }]);
});
