import type { DiffStats } from "renderer/hooks/host-service/useDiffStats";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { deriveTerminalAgentStatus } from "renderer/hooks/host-service/useTerminalAgentStatuses/deriveTerminalAgentStatus";
import { getHighestPriorityStatus, type PaneStatus } from "shared/tabs-types";
import type { SidebarWorkspaceStatusEntry } from "../../DashboardSidebarWorkspaceStatusProvider";

interface CachedStatus {
	bindingRows: readonly TerminalAgentBinding[];
	seenAt: readonly (number | undefined)[];
	manualUnread: boolean;
	entry: SidebarWorkspaceStatusEntry;
}

const EMPTY_BINDINGS: readonly TerminalAgentBinding[] = [];

function diffStatsEqual(
	left: DiffStats | null,
	right: DiffStats | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.additions === right.additions &&
			left.deletions === right.deletions)
	);
}

function mapsShallowEqual<Value>(
	left: ReadonlyMap<string, Value>,
	right: ReadonlyMap<string, Value>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [key, value] of left) {
		if (right.get(key) !== value) return false;
	}
	return true;
}

function entriesEqual(
	left: SidebarWorkspaceStatusEntry,
	right: SidebarWorkspaceStatusEntry,
): boolean {
	return (
		left.status === right.status &&
		left.isUnread === right.isUnread &&
		diffStatsEqual(left.diffStats, right.diffStats) &&
		mapsShallowEqual(left.bindings, right.bindings) &&
		mapsShallowEqual(left.statuses, right.statuses)
	);
}

export class SidebarStatusCache {
	private cached = new Map<string, CachedStatus>();

	update({
		targets,
		bindingRowsByIndex,
		manualUnread,
		terminalSeenAt,
		activeWorkspaceId,
		activeDiffStats,
	}: {
		targets: readonly { workspaceId: string }[];
		bindingRowsByIndex: readonly (
			| readonly TerminalAgentBinding[]
			| undefined
		)[];
		manualUnread: Readonly<Record<string, boolean>>;
		terminalSeenAt: Readonly<Record<string, number>>;
		activeWorkspaceId: string | null;
		activeDiffStats: DiffStats | null;
	}): Map<string, SidebarWorkspaceStatusEntry> {
		const nextCache = new Map<string, CachedStatus>();
		const entries = new Map<string, SidebarWorkspaceStatusEntry>();
		targets.forEach(({ workspaceId }, index) => {
			const bindingRows = bindingRowsByIndex[index] ?? EMPTY_BINDINGS;
			const hasManualUnread = Boolean(manualUnread[workspaceId]);
			const diffStats =
				workspaceId === activeWorkspaceId ? activeDiffStats : null;
			const previous = this.cached.get(workspaceId);
			if (
				previous &&
				previous.bindingRows === bindingRows &&
				previous.manualUnread === hasManualUnread &&
				diffStatsEqual(previous.entry.diffStats, diffStats) &&
				bindingRows.every(
					(binding, index) =>
						previous.seenAt[index] === terminalSeenAt[binding.terminalId],
				)
			) {
				nextCache.set(workspaceId, previous);
				entries.set(workspaceId, previous.entry);
				return;
			}

			const bindings = new Map<string, TerminalAgentBinding>();
			const statuses = new Map<string, PaneStatus>();
			for (const binding of bindingRows) {
				bindings.set(binding.terminalId, binding);
				statuses.set(
					binding.terminalId,
					deriveTerminalAgentStatus({
						lastEventType: binding.lastEventType,
						lastEventAt: binding.lastEventAt,
						lastSeenAt: terminalSeenAt[binding.terminalId],
					}),
				);
			}
			const hasAttentionTerminal = [...statuses.values()].some(
				(status) => status === "review" || status === "failed",
			);
			const candidate: SidebarWorkspaceStatusEntry = {
				status: getHighestPriorityStatus([
					hasManualUnread ? "review" : undefined,
					...statuses.values(),
				]),
				isUnread: hasManualUnread || hasAttentionTerminal,
				bindings,
				statuses,
				diffStats,
			};
			const entry =
				previous && entriesEqual(previous.entry, candidate)
					? previous.entry
					: candidate;
			nextCache.set(workspaceId, {
				bindingRows,
				seenAt: bindingRows.map(
					(binding) => terminalSeenAt[binding.terminalId],
				),
				manualUnread: hasManualUnread,
				entry,
			});
			entries.set(workspaceId, entry);
		});
		this.cached = nextCache;
		return entries;
	}
}
