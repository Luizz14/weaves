import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "renderer/components/agents/code-block";

const components: Components = {
	pre: ({ children }) => <div className="my-3">{children}</div>,
	code: ({ className, children }) => {
		const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
		const code = String(children).replace(/\n$/, "");
		return language || String(children).includes("\n") ? (
			<CodeBlock
				code={code}
				language={
					language === "bash" ||
					language === "diff" ||
					language === "json" ||
					language === "tsx" ||
					language === "typescript"
						? language
						: "text"
				}
			/>
		) : (
			<code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
				{children}
			</code>
		);
	},
	a: ({ children, href }) => (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="underline underline-offset-2"
		>
			{children}
		</a>
	),
};
const plugins = [remarkGfm];
export function CodexMarkdown({ text }: { text: string }) {
	return (
		<div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-7 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
			<ReactMarkdown remarkPlugins={plugins} components={components}>
				{text}
			</ReactMarkdown>
		</div>
	);
}
