import type { workspaceTrpc } from "@superset/workspace-client";
import type { FsWatchEvent } from "@superset/workspace-fs/client";
import { isImageFile, isPdfFile, isVideoFile } from "shared/file-types";
import type {
	ConflictResolution,
	ConflictState,
	ContentState,
	SaveResult,
	SharedFileDocument,
} from "./types";

type WorkspaceTrpcClient = ReturnType<typeof workspaceTrpc.createClient>;

interface DocumentEntry {
	id: string;
	workspaceId: string;
	absolutePath: string;
	trpcClient: WorkspaceTrpcClient;
	content: ContentState;
	savedContentText: string | null;
	pendingSave: boolean;
	saveError: Error | null;
	formatWarning: string | null;
	conflict: ConflictState | null;
	orphaned: boolean;
	hasExternalChange: boolean;
	isBinary: boolean | null;
	byteSize: number | null;
	refCount: number;
	version: number;
	subscribers: Set<() => void>;
	saveSubscribers: Set<(content: string) => void>;
	retainedAt: number | null;
	stale: boolean;
	loadToken: number;
	unlimited: boolean;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const BINARY_CHECK_SIZE = 8192;
const RETAINED_LIMIT = 30;
const RETAINED_TTL_MS = 10 * 60_000;
const RETAINED_MAX_BYTES = 32 * 1024 * 1024;

const entries = new Map<string, DocumentEntry>();
const pinnedPaths = new Map<string, Set<string>>();
const referencedDocuments = new Set<string>();
export function hasDocumentReference(id: string) {
	return referencedDocuments.has(id);
}
const documentListeners = new Set<(document: SharedFileDocument) => void>();
const saveTransforms = new Map<
	string,
	(
		content: string,
		path: string,
	) => Promise<{ content: string; warning?: string }>
>();
const saveTasks = new Map<string, Promise<SaveResult>>();
export function observeDocuments(
	listener: (document: SharedFileDocument) => void,
) {
	documentListeners.add(listener);
	for (const entry of entries.values()) listener(createHandle(entry));
	return () => {
		documentListeners.delete(listener);
	};
}
export function registerSaveTransform(
	id: string,
	transform: (
		content: string,
		path: string,
	) => Promise<{ content: string; warning?: string }>,
) {
	saveTransforms.set(id, transform);
	return () => {
		if (saveTransforms.get(id) === transform) saveTransforms.delete(id);
	};
}

function key(workspaceId: string, absolutePath: string): string {
	return `${workspaceId}:${absolutePath}`;
}

function notify(entry: DocumentEntry): void {
	entry.version += 1;
	for (const listener of entry.subscribers) {
		listener();
	}
}

function computeDirty(entry: DocumentEntry): boolean {
	if (entry.content.kind !== "text") return false;
	if (entry.savedContentText === null) return false;
	return entry.content.value !== entry.savedContentText;
}

function resetForLoad(entry: DocumentEntry): void {
	entry.content = { kind: "loading" };
	entry.savedContentText = null;
	entry.conflict = null;
	entry.hasExternalChange = false;
	entry.saveError = null;
}

function isBinaryText(content: string): boolean {
	const checkLength = Math.min(content.length, BINARY_CHECK_SIZE);
	for (let i = 0; i < checkLength; i += 1) {
		if (content.charCodeAt(i) === 0) {
			return true;
		}
	}
	return false;
}

export function decodeBase64(value: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		return new Uint8Array(Buffer.from(value, "base64"));
	}
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function toBytes(value: string | Uint8Array): Uint8Array {
	return typeof value === "string" ? decodeBase64(value) : value;
}

async function loadEntry(
	entry: DocumentEntry,
	options: { unlimited?: boolean } = {},
): Promise<void> {
	const token = ++entry.loadToken;
	entry.unlimited = options.unlimited === true;
	const client = entry.trpcClient;
	const readAsBinary =
		isImageFile(entry.absolutePath) ||
		isVideoFile(entry.absolutePath) ||
		isPdfFile(entry.absolutePath);
	const maxBytes = options.unlimited ? undefined : DEFAULT_MAX_BYTES;
	try {
		const result = await client.filesystem.readFile.query({
			workspaceId: entry.workspaceId,
			absolutePath: entry.absolutePath,
			encoding: readAsBinary ? undefined : "utf-8",
			maxBytes,
		});
		if (token !== entry.loadToken) return;

		entry.byteSize = result.byteLength;
		entry.isBinary = readAsBinary ? true : entry.isBinary;
		entry.orphaned = false;
		entry.hasExternalChange = false;

		if (result.exceededLimit) {
			entry.content = { kind: "too-large" };
			notify(entry);
			return;
		}

		if (result.kind === "bytes") {
			entry.isBinary = true;
			entry.content = {
				kind: "bytes",
				value: toBytes(result.content),
				revision: result.revision,
			};
			notify(entry);
			return;
		}

		entry.isBinary = isBinaryText(result.content);
		entry.content = {
			kind: "text",
			value: result.content,
			revision: result.revision,
		};
		entry.savedContentText = result.content;
		notify(entry);
	} catch (error) {
		if (token !== entry.loadToken) return;
		const isNotFound = isEnoentLikeError(error);
		entry.content = isNotFound
			? { kind: "not-found" }
			: { kind: "error", error: error as Error };
		notify(entry);
	}
}

async function revalidateEntry(entry: DocumentEntry): Promise<void> {
	const content = entry.content;
	if (content.kind !== "text" && content.kind !== "bytes") return;
	const token = ++entry.loadToken;
	try {
		const result = await entry.trpcClient.filesystem.readFile.query({
			workspaceId: entry.workspaceId,
			absolutePath: entry.absolutePath,
			encoding: content.kind === "bytes" ? undefined : "utf-8",
			maxBytes: DEFAULT_MAX_BYTES,
		});
		if (token !== entry.loadToken) return;
		const current = entry.content;
		if (
			(current.kind === "text" || current.kind === "bytes") &&
			current.revision === result.revision
		)
			return;
		if (current !== content || computeDirty(entry)) {
			entry.hasExternalChange = true;
			notify(entry);
			return;
		}
		if (result.exceededLimit) {
			void loadEntry(entry);
			return;
		}
		entry.byteSize = result.byteLength;
		entry.orphaned = false;
		if (result.kind === "bytes") {
			entry.content = {
				kind: "bytes",
				value: toBytes(result.content),
				revision: result.revision,
			};
		} else {
			entry.isBinary = isBinaryText(result.content);
			entry.content = {
				kind: "text",
				value: result.content,
				revision: result.revision,
			};
			entry.savedContentText = result.content;
		}
		notify(entry);
	} catch (error) {
		if (token !== entry.loadToken || entry.content !== content) return;
		if (isEnoentLikeError(error)) {
			entry.orphaned = true;
			notify(entry);
		}
	}
}

function isPinned(entry: DocumentEntry): boolean {
	return pinnedPaths.get(entry.workspaceId)?.has(entry.absolutePath) === true;
}

function retainedBytes(entry: DocumentEntry): number {
	if (entry.content.kind === "text") return entry.content.value.length * 2;
	if (entry.content.kind === "bytes") return entry.content.value.byteLength;
	return 0;
}

function canEvict(entry: DocumentEntry): boolean {
	return (
		entry.refCount <= 0 &&
		entry.retainedAt !== null &&
		!isPinned(entry) &&
		!computeDirty(entry) &&
		!entry.pendingSave &&
		!entry.conflict &&
		!saveTasks.has(entry.id)
	);
}

function sweepRetained(now = Date.now()): void {
	const retained = [...entries.values()]
		.filter(canEvict)
		.sort((a, b) => (a.retainedAt ?? 0) - (b.retainedAt ?? 0));
	let count = retained.length;
	let bytes = retained.reduce(
		(total, entry) => total + retainedBytes(entry),
		0,
	);
	for (const entry of retained) {
		const expired = now - (entry.retainedAt ?? now) > RETAINED_TTL_MS;
		if (!expired && count <= RETAINED_LIMIT && bytes <= RETAINED_MAX_BYTES)
			continue;
		entries.delete(key(entry.workspaceId, entry.absolutePath));
		count -= 1;
		bytes -= retainedBytes(entry);
	}
}

/**
 * Documents whose file panes still exist in the workspace layout stay loaded
 * while their tab is hidden, like editor models of background tabs.
 */
export function setPinnedDocuments(
	workspaceId: string,
	absolutePaths: Iterable<string>,
): void {
	pinnedPaths.set(workspaceId, new Set(absolutePaths));
	sweepRetained();
}

export function __resetDocumentStoreForTesting(): void {
	entries.clear();
	pinnedPaths.clear();
	referencedDocuments.clear();
}

function isEnoentLikeError(error: unknown): boolean {
	if (!error) return false;
	const message =
		error instanceof Error ? error.message.toLowerCase() : String(error);
	return (
		message.includes("enoent") ||
		message.includes("no such file") ||
		message.includes("not found")
	);
}

async function fetchCurrentDiskContent(
	entry: DocumentEntry,
): Promise<string | null> {
	if (entry.isBinary) return null;
	const client = entry.trpcClient;
	try {
		const result = await client.filesystem.readFile.query({
			workspaceId: entry.workspaceId,
			absolutePath: entry.absolutePath,
			encoding: "utf-8",
			maxBytes: DEFAULT_MAX_BYTES,
		});
		if (result.kind !== "text" || result.exceededLimit) return null;
		if (isBinaryText(result.content)) return null;
		return result.content;
	} catch {
		return null;
	}
}

async function saveEntry(
	entry: DocumentEntry,
	opts?: { force?: boolean; skipFormatting?: boolean },
): Promise<SaveResult> {
	if (entry.content.kind !== "text") {
		return {
			status: "error",
			error: new Error("Cannot save non-text content"),
		};
	}
	const client = entry.trpcClient;
	let currentValue = entry.content.value;
	const currentRevision = entry.content.revision;
	entry.pendingSave = true;
	entry.saveError = null;
	notify(entry);
	try {
		const before = currentValue;
		const path = entry.absolutePath;
		entry.formatWarning = null;
		const transform = opts?.skipFormatting
			? undefined
			: saveTransforms.get(entry.id);
		if (transform) {
			try {
				const formatted = await transform(before, path);
				if (
					entry.content.kind === "text" &&
					entry.content.value === before &&
					entry.absolutePath === path
				) {
					currentValue = formatted.content;
					entry.content = { ...entry.content, value: currentValue };
					entry.formatWarning = formatted.warning ?? null;
					notify(entry);
				} else if (entry.content.kind === "text") {
					currentValue = entry.content.value;
					entry.formatWarning = "stale-result";
				}
			} catch {
				if (entry.content.kind === "text") currentValue = entry.content.value;
				entry.formatWarning = "format-failed";
			}
		}
		const result = await client.filesystem.writeFile.mutate({
			workspaceId: entry.workspaceId,
			absolutePath: entry.absolutePath,
			content: currentValue,
			encoding: "utf-8",
			precondition:
				opts?.force || !currentRevision
					? undefined
					: { ifMatch: currentRevision },
		});

		entry.pendingSave = false;

		if (!result.ok) {
			if (result.reason === "conflict") {
				const diskContent = await fetchCurrentDiskContent(entry);
				entry.conflict = { diskContent };
				entry.hasExternalChange = true;
				notify(entry);
				return { status: "conflict", diskContent };
			}
			notify(entry);
			return { status: result.reason };
		}

		if (entry.content.kind === "text") {
			entry.content = {
				...entry.content,
				revision: result.revision,
			};
		}
		entry.savedContentText = currentValue;
		entry.conflict = null;
		entry.hasExternalChange = false;
		notify(entry);
		for (const listener of entry.saveSubscribers) {
			try {
				listener(currentValue);
			} catch (error) {
				console.error("[file-document] Save listener failed", error);
			}
		}
		return { status: "saved", revision: result.revision };
	} catch (error) {
		entry.pendingSave = false;
		entry.saveError = error as Error;
		notify(entry);
		return { status: "error", error: error as Error };
	}
}

function createHandle(entry: DocumentEntry): SharedFileDocument {
	return {
		get id() {
			return entry.id;
		},
		get workspaceId() {
			return entry.workspaceId;
		},
		get absolutePath() {
			return entry.absolutePath;
		},
		get content() {
			return entry.content;
		},
		get dirty() {
			return computeDirty(entry);
		},
		get pendingSave() {
			return entry.pendingSave;
		},
		get formatWarning() {
			return entry.formatWarning;
		},
		get saveError() {
			return entry.saveError;
		},
		get conflict() {
			return entry.conflict;
		},
		get orphaned() {
			return entry.orphaned;
		},
		get hasExternalChange() {
			return entry.hasExternalChange;
		},
		get isBinary() {
			return entry.isBinary;
		},
		get byteSize() {
			return entry.byteSize;
		},
		setContent(next) {
			if (entry.content.kind !== "text") return;
			if (entry.content.value === next) return;
			entry.content = { ...entry.content, value: next };
			notify(entry);
		},
		async save(opts): Promise<SaveResult> {
			let previous = saveTasks.get(entry.id);
			while (previous) {
				await previous;
				if (!computeDirty(entry) && entry.content.kind === "text")
					return { status: "saved", revision: entry.content.revision };
				previous = saveTasks.get(entry.id);
			}
			const task = saveEntry(entry, opts);
			saveTasks.set(entry.id, task);
			try {
				return await task;
			} finally {
				if (saveTasks.get(entry.id) === task) saveTasks.delete(entry.id);
			}
		},
		async reload() {
			resetForLoad(entry);
			notify(entry);
			await loadEntry(entry);
		},
		async loadUnlimited() {
			resetForLoad(entry);
			notify(entry);
			await loadEntry(entry, { unlimited: true });
		},
		async resolveConflict(choice: ConflictResolution) {
			if (!entry.conflict) return;
			if (choice === "reload") {
				await this.reload();
				return;
			}
			if (choice === "overwrite") {
				entry.conflict = null;
				notify(entry);
				await this.save({ force: true });
				return;
			}
			// keep — dismiss the dialog; buffer stays dirty against stale revision
			entry.conflict = null;
			notify(entry);
		},
		clearSaveError() {
			if (entry.saveError === null) return;
			entry.saveError = null;
			notify(entry);
		},
		subscribe(listener) {
			entry.subscribers.add(listener);
			return () => {
				entry.subscribers.delete(listener);
			};
		},
		getVersion() {
			return entry.version;
		},
		subscribeSaved(listener) {
			entry.saveSubscribers.add(listener);
			return () => {
				entry.saveSubscribers.delete(listener);
			};
		},
	};
}

export function acquireDocument(
	workspaceId: string,
	absolutePath: string,
	trpcClient: WorkspaceTrpcClient,
): SharedFileDocument {
	const k = key(workspaceId, absolutePath);
	let entry = entries.get(k);
	if (!entry) {
		entry = {
			id: crypto.randomUUID(),
			workspaceId,
			absolutePath,
			trpcClient,
			content: { kind: "loading" },
			savedContentText: null,
			pendingSave: false,
			saveError: null,
			formatWarning: null,
			conflict: null,
			orphaned: false,
			hasExternalChange: false,
			isBinary: null,
			byteSize: null,
			refCount: 0,
			version: 0,
			subscribers: new Set(),
			saveSubscribers: new Set(),
			retainedAt: null,
			stale: false,
			loadToken: 0,
			unlimited: false,
		};
		entries.set(k, entry);
		void loadEntry(entry);
	} else {
		entry.trpcClient = trpcClient;
		if (entry.retainedAt !== null) {
			entry.retainedAt = null;
			if (entry.stale) {
				entry.stale = false;
				void revalidateEntry(entry);
			}
		}
	}
	entry.refCount += 1;
	referencedDocuments.add(entry.id);
	sweepRetained();
	const handle = createHandle(entry);
	for (const listener of documentListeners) listener(handle);
	return handle;
}

export function releaseDocument(
	workspaceId: string,
	absolutePath: string,
): void {
	const k = key(workspaceId, absolutePath);
	const entry = entries.get(k);
	if (!entry) return;
	entry.refCount -= 1;
	if (entry.refCount > 0) return;
	referencedDocuments.delete(entry.id);
	notify(entry);
	if (computeDirty(entry) || entry.orphaned) return;
	const retainable =
		(entry.content.kind === "text" || entry.content.kind === "bytes") &&
		!entry.unlimited;
	if (!retainable) {
		entries.delete(k);
		return;
	}
	entry.retainedAt = Date.now();
	entry.stale = true;
	sweepRetained();
}

export function getDocument(
	workspaceId: string,
	absolutePath: string,
): SharedFileDocument | null {
	const entry = entries.get(key(workspaceId, absolutePath));
	if (!entry) return null;
	return createHandle(entry);
}

/**
 * Reacts to a workspace file-system event. Called by FileDocumentStoreProvider
 * from its `useWorkspaceEvent("fs:events", ...)` subscription.
 *
 * The @parcel/watcher layer under `packages/workspace-fs/src/watch.ts` already
 * coalesces rapid-fire events and pairs delete+create sequences into rename
 * events, so a "delete" event here is a real delete — no additional debounce
 * is required.
 */
export function dispatchFsEvent(
	workspaceId: string,
	event: FsWatchEvent,
): void {
	// Snapshot before iterating — the rename branch below does entries.delete +
	// entries.set on the same map, and JS Map iterators visit keys inserted
	// mid-iteration, which would revisit the same entry and loop forever.
	for (const entry of Array.from(entries.values())) {
		if (entry.workspaceId !== workspaceId) continue;
		const affects =
			entry.absolutePath === event.absolutePath ||
			(event.kind === "rename" && event.oldAbsolutePath === entry.absolutePath);
		if (!affects) continue;

		const isContentMutation =
			event.kind === "create" ||
			event.kind === "update" ||
			event.kind === "overflow" ||
			(event.kind === "rename" && event.absolutePath === entry.absolutePath);

		if (event.kind === "delete") {
			entry.orphaned = true;
			notify(entry);
			continue;
		}

		if (
			event.kind === "rename" &&
			event.oldAbsolutePath === entry.absolutePath
		) {
			const oldKey = key(entry.workspaceId, entry.absolutePath);
			entries.delete(oldKey);
			entry.absolutePath = event.absolutePath;
			entries.set(key(entry.workspaceId, entry.absolutePath), entry);
			notify(entry);
			continue;
		}

		if (isContentMutation) {
			if (entry.orphaned) entry.orphaned = false;
			if (computeDirty(entry)) {
				entry.hasExternalChange = true;
				notify(entry);
			} else {
				void loadEntry(entry);
			}
		}
	}
}
