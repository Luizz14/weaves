import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { downloads } from "@superset/local-db";
import { desc, eq, ne } from "drizzle-orm";
import { getNativePath } from "main/native/platform";
import { localDb } from "../local-db";
import { browserManager } from "./browser-manager";
import { dispatchNativeBrowser } from "./native-browser";

const MAX_TRACKED_DOWNLOADS = 200;

interface NativeDownloadEvent {
	kind?: string;
	id?: string;
	downloadId?: string;
	url?: string;
	filename?: string;
	savePath?: string;
	mimeType?: string | null;
	totalBytes?: number | null;
	receivedBytes?: number;
	state?: "progressing" | "completed" | "cancelled" | "interrupted";
	completedAt?: number;
}

function downloadsDir(): string {
	try {
		return getNativePath("downloads");
	} catch {
		return join(homedir(), "Downloads");
	}
}

/** Tracks native CEF downloads without retaining a browser runtime object. */
class DownloadManager extends EventEmitter {
	private readonly reservedPaths = new Set<string>();
	private started = false;

	private reserveSavePath(dir: string, filename: string): string {
		const ext = extname(filename);
		const base = basename(filename, ext);
		let candidate = join(dir, filename);
		for (
			let n = 1;
			existsSync(candidate) || this.reservedPaths.has(candidate);
			n++
		) {
			candidate = join(dir, `${base} (${n})${ext}`);
		}
		this.reservedPaths.add(candidate);
		return candidate;
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		localDb
			.update(downloads)
			.set({ state: "interrupted" })
			.where(eq(downloads.state, "progressing"))
			.run();
		browserManager.on("download", this.handleNativeEvent);
	}

	private readonly handleNativeEvent = (raw: NativeDownloadEvent): void => {
		const id = raw.downloadId ?? raw.id;
		if (!id || typeof raw.url !== "string") return;
		const state = raw.state ?? "progressing";
		const existing = this.getById(id);
		const savePath =
			raw.savePath ??
			existing?.savePath ??
			this.reserveSavePath(downloadsDir(), raw.filename ?? id);
		const filename = raw.filename ?? existing?.filename ?? basename(savePath);
		if (!existing) {
			localDb
				.insert(downloads)
				.values({
					id,
					url: raw.url,
					filename,
					savePath,
					mimeType: raw.mimeType ?? null,
					totalBytes: raw.totalBytes ?? null,
					receivedBytes: raw.receivedBytes ?? 0,
					state,
					startedAt: Date.now(),
					completedAt:
						state === "progressing" ? null : (raw.completedAt ?? Date.now()),
				})
				.run();
		} else {
			localDb
				.update(downloads)
				.set({
					receivedBytes: raw.receivedBytes ?? existing.receivedBytes,
					totalBytes: raw.totalBytes ?? existing.totalBytes,
					state,
					completedAt:
						state === "progressing" ? null : (raw.completedAt ?? Date.now()),
				})
				.where(eq(downloads.id, id))
				.run();
		}
		if (state !== "progressing") this.reservedPaths.delete(savePath);
		this.emit("changed");
	};

	list() {
		return localDb
			.select()
			.from(downloads)
			.orderBy(desc(downloads.startedAt))
			.limit(MAX_TRACKED_DOWNLOADS)
			.all();
	}

	getById(id: string) {
		return localDb.select().from(downloads).where(eq(downloads.id, id)).get();
	}

	async cancel(id: string, ownerLabel: string): Promise<boolean> {
		return dispatchNativeBrowser<boolean>(
			"browser.download.cancel",
			{ id },
			ownerLabel,
		);
	}

	clear(): void {
		localDb.delete(downloads).where(ne(downloads.state, "progressing")).run();
		this.emit("changed");
	}

	showInFolder(savePath: string, ownerLabel: string): Promise<void> {
		return dispatchNativeBrowser(
			"shell.showInFolder",
			{ path: savePath },
			ownerLabel,
		);
	}

	openFile(savePath: string, ownerLabel: string): Promise<string> {
		return dispatchNativeBrowser<string>(
			"shell.openFile",
			{ path: savePath },
			ownerLabel,
		);
	}
}

export const downloadManager = new DownloadManager();
