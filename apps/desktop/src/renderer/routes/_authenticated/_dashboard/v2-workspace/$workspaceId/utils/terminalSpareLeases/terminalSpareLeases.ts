/** Below the host's 10-minute spare lifetime, so a kept lease is still live. */
const LEASE_MAX_AGE_MS = 9 * 60_000;

interface SpareLease {
	terminalId: string;
	themeType: string;
	obtainedAt: number;
}

const leases = new Map<string, SpareLease>();
const requests = new Map<string, Promise<void>>();

function isFresh(lease: SpareLease, themeType: string, now: number): boolean {
	return (
		lease.themeType === themeType && now - lease.obtainedAt <= LEASE_MAX_AGE_MS
	);
}

/**
 * The id of a shell the host already started for this workspace, handed out
 * once. Null when there is none (or it was started for another theme): the
 * caller mints a fresh id and the host spawns as usual.
 */
export function takeSpareLease(
	workspaceId: string,
	themeType: string,
	now = Date.now(),
): string | null {
	const lease = leases.get(workspaceId);
	if (!lease) return null;
	leases.delete(workspaceId);
	return isFresh(lease, themeType, now) ? lease.terminalId : null;
}

export function ensureSpareLease({
	workspaceId,
	themeType,
	prepare,
	release,
}: {
	workspaceId: string;
	themeType: string;
	prepare: () => Promise<{ terminalId: string | null }>;
	release: (terminalId: string) => Promise<unknown>;
}): Promise<void> {
	const lease = leases.get(workspaceId);
	if (lease && isFresh(lease, themeType, Date.now())) return Promise.resolve();
	if (lease) {
		leases.delete(workspaceId);
		void release(lease.terminalId).catch(() => {});
	}
	const inflight = requests.get(workspaceId);
	if (inflight) return inflight;
	const request = prepare()
		.then(({ terminalId }) => {
			if (terminalId) {
				leases.set(workspaceId, {
					terminalId,
					themeType,
					obtainedAt: Date.now(),
				});
			}
		})
		.catch(() => {})
		.finally(() => {
			requests.delete(workspaceId);
		});
	requests.set(workspaceId, request);
	return request;
}

export function resetSpareLeasesForTesting(): void {
	leases.clear();
	requests.clear();
}
