import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileToBase64 } from "renderer/lib/file-to-base64";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

export type ChatAttachment = {
	/** Local id, stable for the life of the pill. Not the server's id. */
	id: string;
	name: string;
	mimeType: string;
	sizeBytes: number;
	/** Object/data URL for an image preview; undefined for non-images. */
	previewUrl?: string;
	state:
		| { kind: "uploading" }
		| { kind: "ready"; attachmentId: string }
		| { kind: "error"; message: string };
};

type SettledUpload =
	| { kind: "ready"; attachmentId: string }
	| { kind: "error"; message: string };

export type ChatAttachmentsApi = {
	attachments: ChatAttachment[];
	/** Starts an upload per file immediately. Ignores duplicates by (name,size,lastModified). */
	add: (files: File[]) => void;
	remove: (id: string) => void;
	clear: () => void;
	retry: (id: string) => void;
	/** Resolves once every in-flight upload settled. */
	awaitReady: () => Promise<{
		ready: { attachmentId: string; name: string; mimeType: string }[];
		errors: { name: string; message: string }[];
	}>;
};

let idCounter = 0;

function nextId(): string {
	idCounter += 1;
	return `chat-attachment-${idCounter}`;
}

function dedupeKey(file: File): string {
	return `${file.name}::${file.size}::${file.lastModified}`;
}

function createPreviewUrl(file: File): string | undefined {
	if (!file.type.startsWith("image/")) return undefined;
	if (typeof URL.createObjectURL !== "function") return undefined;
	return URL.createObjectURL(file);
}

export function useChatAttachments(hostUrl: string | null): ChatAttachmentsApi {
	const { t } = useLingui();
	const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

	const latest = useRef<ChatAttachment[]>([]);
	const files = useRef(new Map<string, File>());
	const previewUrls = useRef(new Map<string, string>());
	const uploads = useRef(new Map<string, Promise<SettledUpload>>());
	const keys = useRef(new Map<string, string>());
	const host = useRef(hostUrl);
	const mounted = useRef(true);

	host.current = hostUrl;

	const commit = useCallback((next: ChatAttachment[]) => {
		latest.current = next;
		setAttachments(next);
	}, []);

	const patchState = useCallback(
		(id: string, state: ChatAttachment["state"]) => {
			if (!mounted.current) return;
			const next = latest.current.map((attachment) =>
				attachment.id === id ? { ...attachment, state } : attachment,
			);
			commit(next);
		},
		[commit],
	);

	const startUpload = useCallback(
		(id: string, file: File): void => {
			const targetHost = host.current;
			if (!targetHost) {
				const message = t({
					message: "Not connected to a host yet — try attaching again.",
				});
				uploads.current.set(id, Promise.resolve({ kind: "error", message }));
				patchState(id, { kind: "error", message });
				return;
			}

			const upload = (async (): Promise<SettledUpload> => {
				try {
					const data = await fileToBase64(file);
					const result = await getHostServiceClientByUrl(
						targetHost,
					).attachments.upload.mutate({
						data: { kind: "base64", data },
						mediaType: file.type || "application/octet-stream",
						originalFilename: file.name,
					});
					const settled: SettledUpload = {
						kind: "ready",
						attachmentId: result.attachmentId,
					};
					patchState(id, settled);
					return settled;
				} catch (error) {
					const settled: SettledUpload = {
						kind: "error",
						message: errorMessage(error, t({ message: "Upload failed." })),
					};
					patchState(id, settled);
					return settled;
				}
			})();

			uploads.current.set(id, upload);
		},
		[patchState, t],
	);

	const add = useCallback(
		(incoming: File[]) => {
			const accepted: { attachment: ChatAttachment; file: File }[] = [];
			for (const file of incoming) {
				const key = dedupeKey(file);
				if (keys.current.has(key)) continue;
				const id = nextId();
				keys.current.set(key, id);
				files.current.set(id, file);
				const previewUrl = createPreviewUrl(file);
				if (previewUrl) previewUrls.current.set(id, previewUrl);
				accepted.push({
					attachment: {
						id,
						name: file.name,
						mimeType: file.type || "application/octet-stream",
						sizeBytes: file.size,
						previewUrl,
						state: { kind: "uploading" },
					},
					file,
				});
			}
			if (accepted.length === 0) return;

			commit([...latest.current, ...accepted.map((entry) => entry.attachment)]);
			for (const entry of accepted) {
				startUpload(entry.attachment.id, entry.file);
			}
		},
		[commit, startUpload],
	);

	const forget = useCallback((id: string) => {
		const previewUrl = previewUrls.current.get(id);
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrls.current.delete(id);
		const file = files.current.get(id);
		if (file) keys.current.delete(dedupeKey(file));
		files.current.delete(id);
		uploads.current.delete(id);
	}, []);

	const remove = useCallback(
		(id: string) => {
			forget(id);
			commit(latest.current.filter((attachment) => attachment.id !== id));
		},
		[commit, forget],
	);

	const clear = useCallback(() => {
		for (const id of [...files.current.keys()]) forget(id);
		commit([]);
	}, [commit, forget]);

	const retry = useCallback(
		(id: string) => {
			const file = files.current.get(id);
			if (!file) return;
			uploads.current.delete(id);
			patchState(id, { kind: "uploading" });
			startUpload(id, file);
		},
		[patchState, startUpload],
	);

	const awaitReady = useCallback(async () => {
		const pending = latest.current.flatMap((attachment) => {
			const upload = uploads.current.get(attachment.id);
			return upload ? [{ attachment, upload }] : [];
		});
		const settled = await Promise.all(pending.map((entry) => entry.upload));

		const ready: { attachmentId: string; name: string; mimeType: string }[] =
			[];
		const errors: { name: string; message: string }[] = [];
		settled.forEach((result, index) => {
			const { attachment } = pending[index];
			if (result.kind === "ready") {
				ready.push({
					attachmentId: result.attachmentId,
					name: attachment.name,
					mimeType: attachment.mimeType,
				});
			} else {
				errors.push({ name: attachment.name, message: result.message });
			}
		});
		return { ready, errors };
	}, []);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			for (const previewUrl of previewUrls.current.values()) {
				URL.revokeObjectURL(previewUrl);
			}
			previewUrls.current.clear();
		};
	}, []);

	return { attachments, add, remove, clear, retry, awaitReady };
}
