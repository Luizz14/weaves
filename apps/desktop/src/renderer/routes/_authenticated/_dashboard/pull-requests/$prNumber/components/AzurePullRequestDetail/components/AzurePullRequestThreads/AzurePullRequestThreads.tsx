import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Textarea } from "@superset/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LuCheck, LuCornerDownRight, LuLoaderCircle } from "react-icons/lu";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

type AzurePullRequestThreadsProps = {
	hostUrl: string;
	projectId: string;
	pullRequestId: number;
};

export function AzurePullRequestThreads({
	hostUrl,
	projectId,
	pullRequestId,
}: AzurePullRequestThreadsProps) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const [replyByThread, setReplyByThread] = useState<
		ReadonlyMap<number, string>
	>(new Map());
	const queryKey = [
		"azure-devops",
		"pull-request-threads",
		hostUrl,
		projectId,
		pullRequestId,
	] as const;
	const threads = useQuery({
		queryKey,
		queryFn: () =>
			getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.getPullRequestThreads.query({ projectId, pullRequestId }),
		staleTime: 15_000,
	});
	const reply = useMutation({
		mutationFn: ({ threadId, body }: { threadId: number; body: string }) =>
			getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.replyToPullRequestThread.mutate({
				projectId,
				pullRequestId,
				threadId,
				body,
			}),
		onSuccess: (_, variables) => {
			setReplyByThread((current) => {
				const next = new Map(current);
				next.delete(variables.threadId);
				return next;
			});
			void queryClient.invalidateQueries({ queryKey });
		},
	});
	const resolve = useMutation({
		mutationFn: ({
			threadId,
			resolved,
		}: {
			threadId: number;
			resolved: boolean;
		}) =>
			getHostServiceClientByUrl(
				hostUrl,
			).azureDevOps.setPullRequestThreadResolution.mutate({
				projectId,
				pullRequestId,
				threadId,
				resolved,
			}),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
	});

	if (threads.isPending) {
		return (
			<div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
				<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
				<Trans>Loading review threads…</Trans>
			</div>
		);
	}
	if (!threads.data?.length) return null;

	return (
		<section className="border-t border-white/10 bg-[#0d1117] p-4 text-[#e6edf3]">
			<h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#8b949e]">
				<Trans>Review threads</Trans>
			</h2>
			<div className="mt-3 grid gap-3">
				{threads.data.map((thread) => {
					const resolved =
						thread.status === "fixed" || thread.status === "closed";
					const replyBody = replyByThread.get(thread.id) ?? "";
					return (
						<article
							key={thread.id}
							className="rounded-xl bg-white/5 p-4 shadow-[0_0_0_1px_rgb(255_255_255/0.1)]"
						>
							<div className="flex items-center gap-2 text-xs text-[#8b949e]">
								<span className="font-mono">
									{thread.filePath ?? t({ message: "General comment" })}
								</span>
								{thread.line ? (
									<span className="tabular-nums">L{thread.line}</span>
								) : null}
								<Button
									variant="ghost"
									size="xs"
									className="ml-auto text-[#8b949e] hover:bg-white/10 hover:text-white"
									onClick={() =>
										resolve.mutate({ threadId: thread.id, resolved: !resolved })
									}
								>
									<LuCheck />
									{resolved ? <Trans>Reopen</Trans> : <Trans>Resolve</Trans>}
								</Button>
							</div>
							<div className="mt-3 space-y-3">
								{thread.comments.map((comment) => (
									<div key={comment.id} className="text-sm">
										<p className="text-xs font-medium text-[#8b949e]">
											{comment.author}
										</p>
										<p className="mt-1 whitespace-pre-wrap text-pretty">
											{comment.body}
										</p>
									</div>
								))}
							</div>
							<div className="mt-4 flex items-end gap-2">
								<Textarea
									value={replyBody}
									onChange={(event) =>
										setReplyByThread((current) =>
											new Map(current).set(thread.id, event.target.value),
										)
									}
									placeholder={t({ message: "Reply…" })}
									className="min-h-16 border-white/10 bg-black/20 text-sm"
								/>
								<Button
									size="icon-lg"
									disabled={!replyBody.trim() || reply.isPending}
									onClick={() =>
										reply.mutate({
											threadId: thread.id,
											body: replyBody.trim(),
										})
									}
									aria-label={t({ message: "Reply" })}
								>
									<LuCornerDownRight />
								</Button>
							</div>
						</article>
					);
				})}
			</div>
		</section>
	);
}
