import type { ToolContent } from "@superset/chat/protocol";
import { CodeBlock } from "renderer/components/agents/code-block";
import { FileDiff } from "renderer/components/agents/file-diff";
import { toDiffLines } from "./toDiffLines";

export function CodexToolContent({
	content,
	streaming = false,
}: {
	content: ToolContent;
	streaming?: boolean;
}) {
	if (content.type === "diff")
		return (
			<FileDiff
				file={content.path}
				status={streaming ? "streaming" : "complete"}
				lines={toDiffLines(content)}
				copyText={content.newText}
				language="text"
			/>
		);
	if (content.type === "terminal")
		return (
			<CodeBlock
				code={`${content.command}\n${content.output}`}
				language="bash"
				wrap
			/>
		);
	return (
		<div className="whitespace-pre-wrap break-words font-mono text-xs">
			{content.text}
		</div>
	);
}
