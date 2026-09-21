import { Trans, useLingui } from "@lingui/react/macro";
import type { UserInputAnswers } from "@superset/chat/protocol";
import {
	type Decision,
	type Item,
	isKnownItem,
	planDocument,
} from "@superset/chat/protocol";
import { File as FileIcon, Image as ImageIcon } from "lucide-react";
import {
	AgentActivity,
	type AgentActivityTrace,
} from "renderer/components/agents/agent-activity";
import { Message, MessageContent } from "renderer/components/agents/message";
import { TodoList } from "renderer/components/agents/todo-list";
import { ChatError } from "../ChatError/ChatError";
import { CodexApproval } from "../CodexApproval/CodexApproval";
import { CodexMarkdown } from "../CodexMarkdown/CodexMarkdown";
import { CodexPlanCard } from "../CodexPlanCard";
import { CodexQuestion } from "../CodexQuestion/CodexQuestion";
import { CodexToolContent } from "../CodexToolContent/CodexToolContent";

export function CodexItem({
	item,
	running,
	onRespond,
	onAnswer,
}: {
	item: Item;
	running: boolean;
	onRespond: (id: string, decision: Decision) => Promise<void>;
	onAnswer: (id: string, answers: UserInputAnswers) => Promise<void>;
}) {
	const { t } = useLingui();
	if (!isKnownItem(item))
		return <p className="text-xs text-muted-foreground">{item.kind}</p>;
	switch (item.kind) {
		case "user_input_request":
			return <CodexQuestion item={item} onAnswer={onAnswer} />;
		case "user_message": {
			const text = item.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			const files = item.content.filter((part) => part.type === "attachment");
			return (
				<Message from="user" animateIn={false}>
					<MessageContent className="rounded-2xl bg-muted/60 px-4 py-2">
						{files.length > 0 && (
							<ul className="mb-1.5 flex flex-wrap gap-1.5">
								{files.map((file) => (
									<li
										className="flex min-w-0 max-w-56 items-center gap-1.5 rounded-lg bg-background/70 px-2 py-1"
										key={file.attachmentId}
									>
										{file.mimeType.startsWith("image/") ? (
											<ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
										) : (
											<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
										)}
										<span className="min-w-0 truncate text-xs">
											{file.name}
										</span>
									</li>
								))}
							</ul>
						)}
						{text && (
							<div className="whitespace-pre-wrap break-words">{text}</div>
						)}
					</MessageContent>
				</Message>
			);
		}
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
		case "tool_call": {
				const traceKind = ((): AgentActivityTrace["kind"] => {
					switch (item.toolKind) {
						case "execute":
							return "run";
						case "edit":
						case "delete":
						case "move":
							return "write";
						case "read":
							return "read";
						case "search":
						case "fetch":
							return "thinking";
						case "think":
							return "thinking";
						default:
							return "message";
					}
				})();

				const diffContent = item.content.find((c) => c.type === "diff");
				const terminalContent = item.content.find(
					(c) => c.type === "terminal",
				);
				const detail = diffContent
					? diffContent.path
					: terminalContent
						? terminalContent.command.slice(0, 80)
						: item.title;

				return (
					<AgentActivity
						status={
							running && item.status === "running" ? "working" : "complete"
						}
						contentType="trace"
						collapseOnComplete={false}
						defaultOpen={false}
						items={[
							{
								id: item.id,
								type: "trace",
								kind: traceKind,
								label: item.title,
								detail,
							},
						]}
					>
						{item.content.length > 0 && (
							<div className="mt-1 space-y-2">
								{item.content.map((content, index) => (
									<CodexToolContent
										key={`${item.id}:${index}`}
										content={content}
										streaming={item.status === "running"}
									/>
								))}
							</div>
						)}
					</AgentActivity>
				);
			}

		case "plan": {
			const document = planDocument(item);
			if (document)
				return (
					<CodexPlanCard
						text={document}
						running={running && !item.completedAtMs}
					/>
				);
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
		}
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
