import { useSyncExternalStore } from "react";
import { authClient, getAuthToken } from "renderer/lib/auth-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { SessionData } from "./parse-session-snapshot";

interface SessionAtomValue {
	data: SessionData | null;
	error: { status?: number } | null;
	isPending: boolean;
	isRefetching: boolean;
}

interface SessionAtom {
	get(): SessionAtomValue;
	set(value: SessionAtomValue): void;
	listen(listener: (value: SessionAtomValue) => void): () => void;
}

function sessionAtom(): SessionAtom {
	return authClient.$store.atoms.session as SessionAtom;
}

export function seedSession(data: SessionData): void {
	const atom = sessionAtom();
	atom.set({
		...atom.get(),
		data,
		error: null,
		isPending: false,
	});
}

let confirmed = false;
const confirmedListeners = new Set<() => void>();

function setConfirmed(): void {
	if (confirmed) return;
	confirmed = true;
	for (const listener of confirmedListeners) listener();
}

/** Whether the server has answered get-session for the current token. */
export function useSessionConfirmed(): boolean {
	return useSyncExternalStore(
		(listener) => {
			confirmedListeners.add(listener);
			return () => confirmedListeners.delete(listener);
		},
		() => confirmed,
		() => false,
	);
}

let stopSync: (() => void) | null = null;

/**
 * From here on, every get-session the server answers is mirrored into the
 * main process for the next launch. Call it before the authenticated
 * refetch: a fetch already in flight may be the anonymous one.
 */
export function startSessionSnapshotSync(persisted: string | null): void {
	stopSync?.();
	let lastPersisted = persisted;
	const atom = sessionAtom();
	// The mount fetch may already be in flight: the authenticated refetch that
	// replaces it writes an identical "refetching" state, which the auth
	// client's equality gate never publishes.
	let fetching = atom.get().isRefetching;
	const persist = (snapshot: string | null) => {
		const token = getAuthToken();
		if (!token || snapshot === lastPersisted) return;
		lastPersisted = snapshot;
		void electronTrpcClient.auth.persistSessionSnapshot
			.mutate({ token, snapshot })
			.catch((error) => {
				console.warn("[auth] failed to persist the session snapshot", error);
			});
	};
	stopSync = atom.listen((value) => {
		if (value.isRefetching) {
			fetching = true;
			return;
		}
		if (!fetching || value.isPending) return;
		fetching = false;
		if (value.error) {
			if (value.error.status === 401) persist(null);
			return;
		}
		setConfirmed();
		persist(value.data ? JSON.stringify(value.data) : null);
	});
}
