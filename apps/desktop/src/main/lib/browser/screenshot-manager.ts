import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { screenshots } from "@superset/local-db";
import { desc, eq } from "drizzle-orm";
import { localDb } from "../local-db";
import { dispatchNativeBrowser } from "./native-browser";

const MAX_LISTED_SCREENSHOTS = 200;

function screenshotsDir(): string {
	const dir = join(homedir(), "Pictures", "Superset Screenshots");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function timestampedFilename(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `Screenshot ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.png`;
}

function pngSize(buffer: Buffer): { width: number; height: number } {
	if (
		buffer.length >= 24 &&
		buffer.readUInt32BE(0) === 0x89504e47 &&
		buffer.readUInt32BE(4) === 0x0d0a1a0a
	) {
		return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
	}
	return { width: 0, height: 0 };
}

export interface BrowserScreenshotCapture {
	base64: string;
	url: string;
	width?: number;
	height?: number;
}

class ScreenshotManager extends EventEmitter {
	async save(capture: BrowserScreenshotCapture, url: string) {
		const filename = timestampedFilename();
		const savePath = join(screenshotsDir(), filename);
		const pngBuffer = Buffer.from(capture.base64, "base64");
		writeFileSync(savePath, pngBuffer, { mode: 0o600 });
		const size = pngSize(pngBuffer);
		const id = randomUUID();

		localDb
			.insert(screenshots)
			.values({
				id,
				url,
				filename,
				savePath,
				width: capture.width ?? size.width,
				height: capture.height ?? size.height,
				thumbnail: `data:image/png;base64,${capture.base64}`,
				capturedAt: Date.now(),
			})
			.run();
		this.emit("changed");

		return { id, savePath, base64: capture.base64 };
	}

	list() {
		return localDb
			.select()
			.from(screenshots)
			.orderBy(desc(screenshots.capturedAt))
			.limit(MAX_LISTED_SCREENSHOTS)
			.all();
	}

	getById(id: string) {
		return localDb
			.select()
			.from(screenshots)
			.where(eq(screenshots.id, id))
			.get();
	}

	clear(): void {
		localDb.delete(screenshots).run();
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

export const screenshotManager = new ScreenshotManager();
