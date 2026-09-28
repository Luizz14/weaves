import { createWriteStream } from "node:fs";
import { ipcMain, type WebContents } from "electron";
import {
	RENDERER_STARTUP_MARKERS,
	STARTUP_DIAGNOSTICS_CHANNEL,
	type StartupMarker,
} from "shared/startup-diagnostics";
import { createStartupRecorder } from "./recorder";

export const startupDiagnosticsEnabled = Boolean(
	process.env.SUPERSET_STARTUP_DIAGNOSTICS,
);

function createRecorder() {
	const logPath = process.env.SUPERSET_STARTUP_DIAGNOSTICS;
	if (!logPath) return undefined;
	const origin =
		process.hrtime.bigint() - BigInt(Math.round(process.uptime() * 1e9));
	const stream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
	stream.on("error", () => {
		console.error("[startup-diagnostics] Could not write diagnostic durations");
	});
	return createStartupRecorder({
		now: () => Number(process.hrtime.bigint() - origin) / 1e6,
		write: (record) => stream.write(`${JSON.stringify(record)}\n`),
	});
}

const record = createRecorder();

export function markStartup(marker: StartupMarker) {
	record?.(marker);
}

export function observeRendererStartup(webContents: WebContents) {
	if (!record) return;
	const onMark = (event: Electron.IpcMainEvent, marker: unknown) => {
		if (
			event.sender !== webContents ||
			event.senderFrame !== webContents.mainFrame
		)
			return;
		for (const allowed of RENDERER_STARTUP_MARKERS) {
			if (marker === allowed) record(allowed);
		}
	};
	ipcMain.on(STARTUP_DIAGNOSTICS_CHANNEL, onMark);
	webContents.once("destroyed", () => {
		ipcMain.removeListener(STARTUP_DIAGNOSTICS_CHANNEL, onMark);
	});
}
