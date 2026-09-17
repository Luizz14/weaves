import { Trans, useLingui } from "@lingui/react/macro";
import { type Decision, type Item, isKnownItem } from "@superset/chat/protocol";
import { AgentActivity } from "renderer/components/agents/agent-activity";
import { Message, MessageContent } from "renderer/components/agents/message";
import { TodoList } from "renderer/components/agents/todo-list";
import { ToolResult } from "renderer/components/agents/tool-result";
import { ChatError } from "../ChatError/ChatError";
import { CodexApproval } from "../CodexApproval/CodexApproval";
import { CodexMarkdown } from "../CodexMarkdown/CodexMarkdown";
import { CodexToolContent } from "../CodexToolContent/CodexToolContent";

export function CodexItem({
	item,
	running,
	onRespond,
}: {
	item: Item;
	running: boolean;
	onRespond: (id: string, decision: Decision) => Promise<void>;
}) {
	const { t } = useLingui();
	if (!isKnownItem(item))
		return <p className="text-xs text-muted-foreground">{item.kind}</p>;
	switch (item.kind) {
		case "user_message":
			return (
				<Message from="user" animateIn={false}>
					<MessageContent className="rounded-2xl bg-muted/60 px-4 py-2">
						<div className="whitespace-pre-wrap break-words">
							{item.content
								.map((part) => (part.type === "text" ? part.text : part.name))
								.join("\n")}
						</div>
					</MessageContent>
				</Message>
			);
		case "agent_message":
			return (
				<Message from="assistant" animateIn={false}>
					<MessageContent>
						<CodexMarkdown text={item.text} />
					</MessageContent>
				</Message>
			);
		case "reasoning":
			return (
				<AgentActivity
					status={running && !item.completedAtMs ? "working" : "complete"}
					activeLabel={t({ message: "Thinking" })}
					summary={t({ message: "Thinking" })}
					items={[
						{
							id: item.id,
							type: "text",
							content: <CodexMarkdown text={item.summary ?? item.text} />,
						},
					]}
				/>
			);
		case "tool_call":
			return (
				<ToolResult
					tool={item.toolName}
					title={item.title}
					kind={item.toolKind === "execute" ? "terminal" : "custom"}
					status={
						item.status === "running"
							? "running"
							: item.status === "completed"
								? "success"
								: item.status === "failed"
									? "error"
									: "cancelled"
					}
				>
					<div className="space-y-2">
						{item.content.map((content, index) => (
							<CodexToolContent
								key={`${item.id}:${index}`}
								content={content}
								streaming={item.status === "running"}
							/>
						))}
					</div>
				</ToolResult>
			);
		case "plan":
			return (
				<TodoList
					title={t({ message: "Plan" })}
					items={item.entries.map((entry, index) => ({
						id: `${item.id}:${index}`,
						title: entry.text,
						status:
							entry.status === "in_progress" ? "in-progress" : entry.status,
					}))}
				/>
			);
		case "approval_request":
			return <CodexApproval item={item} onRespond={onRespond} />;
		case "notice":
			return item.noticeKind === "error" ? (
				<ChatError
					message={item.text ?? t({ message: "Something went wrong" })}
				/>
			) : (
				<p className="text-xs text-muted-foreground">
					{item.text ?? <Trans>Notice</Trans>}
				</p>
			);
	}
}
