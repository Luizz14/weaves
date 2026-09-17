import { Trans, useLingui } from "@lingui/react/macro";
import type { ChatTransport } from "@superset/chat/client";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
	AnimatedSidebar,
	AnimatedSidebarClose,
	AnimatedSidebarContent,
	AnimatedSidebarHeader,
	useAnimatedSidebar,
} from "renderer/components/motion/animated-sidebar";
import { ChatError } from "../ChatError/ChatError";

export function CodexHistory({
	transport,
	hostKey,
	workspaceId,
	sessionId,
	onSelect,
	onNew,
}: {
	transport: ChatTransport;
	hostKey: string;
	workspaceId: string;
	sessionId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
}) {
	const { t } = useLingui();
	const sidebar = useAnimatedSidebar();
	const sessions = useQuery({
		queryKey: ["codex-chat", hostKey, workspaceId, sessionId],
		queryFn: () =>
			transport.listSessions({ workspaceId, harness: "codex", limit: 200 }),
		refetchInterval: 10000,
	});
	return (
		<AnimatedSidebar
			collapsible="offcanvas"
			ariaLabel={t({ message: "History" })}
			className="h-full @max-[600px]/codex:absolute @max-[600px]/codex:inset-y-0 @max-[600px]/codex:left-0 @max-[600px]/codex:z-20"
			inert={!sidebar.open}
			aria-hidden={!sidebar.open}
			panelClassName="h-full bg-background"
		>
			<AnimatedSidebarHeader className="flex-row items-center border-b p-3">
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						onNew();
						sidebar.setOpen(false);
						sidebar.setOpenMobile(false);
					}}
				>
					<Trans>New chat</Trans>
				</Button>
				<AnimatedSidebarClose aria-label={t({ message: "Close sidebar" })}>
					<X className="size-4" />
				</AnimatedSidebarClose>
			</AnimatedSidebarHeader>
			<AnimatedSidebarContent className="gap-1 p-2">
				{sessions.error && (
					<ChatError
						message={errorMessage(sessions.error)}
						onRetry={() => void sessions.refetch()}
					/>
				)}
				{sessions.isPending && (
					<p className="p-2 text-xs text-muted-foreground">
						<Trans>Loading…</Trans>
					</p>
				)}
				{sessions.data?.map((session) => (
					<button
						key={session.sessionId}
						type="button"
						onClick={() => {
							onSelect(session.sessionId);
							sidebar.setOpen(false);
							sidebar.setOpenMobile(false);
						}}
						aria-current={session.sessionId === sessionId ? "page" : undefined}
						className="w-full truncate rounded-lg px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
						title={session.title ?? session.sessionId}
					>
						{session.title ?? session.sessionId.slice(0, 8)}
					</button>
				))}
			</AnimatedSidebarContent>
		</AnimatedSidebar>
	);
}
