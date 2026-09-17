import { Trans } from "@lingui/react/macro";
import {
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useChatWiring } from "../../../../hooks/usePaneRegistry/hooks/useSessionClient";
export function RecentCodexChats({
	workspaceId,
	onSelect,
}: {
	workspaceId: string;
	onSelect: (id: string, title?: string | null) => void;
}) {
	const { transport, streamBaseUrl } = useChatWiring();
	const [open, setOpen] = useState(false);
	const query = useQuery({
		queryKey: ["codex-recent", streamBaseUrl, workspaceId],
		queryFn: () =>
			transport.listSessions({ workspaceId, harness: "codex", limit: 200 }),
		enabled: open,
		staleTime: 0,
	});
	return (
		<DropdownMenuSub open={open} onOpenChange={setOpen}>
			<DropdownMenuSubTrigger>
				<Trans>Recent chats</Trans>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
				{query.isPending && (
					<DropdownMenuItem disabled>
						<Trans>Loading…</Trans>
					</DropdownMenuItem>
				)}
				{query.error && (
					<DropdownMenuItem
						onSelect={(e) => {
							e.preventDefault();
							void query.refetch();
						}}
					>
						<Trans>Retry</Trans>
					</DropdownMenuItem>
				)}
				{query.data?.length === 0 && (
					<DropdownMenuItem disabled>
						<Trans>No conversations yet</Trans>
					</DropdownMenuItem>
				)}
				{query.data?.map((session) => (
					<DropdownMenuItem
						key={session.sessionId}
						onSelect={() => onSelect(session.sessionId, session.title)}
					>
						<span className="truncate">
							{session.title ?? session.sessionId.slice(0, 8)}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
