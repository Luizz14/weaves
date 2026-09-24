/**
 * Authenticated loopback control surface for browser panes.
 *
 * This process is a trusted host-service client. Guest documents never receive
 * the secret or this transport; every operation is scoped by workspace and the
 * native browser manager owns the CEF lifetime.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import express, { type Request, type Response } from "express";
import { type WebSocket, WebSocketServer } from "ws";
import { setBrowserBridgeInfo } from "./browser-bridge-info";
import {
	type BrowserOpenRequest,
	browserManager,
	CdpBusyError,
	resolveGuestUrl,
} from "./browser-manager";
import { listChromeImportSources } from "./chrome-history-import";

const OPEN_PANE_TIMEOUT_MS = 15_000;
const MAX_CDP_MESSAGE_BYTES = 4 * 1024 * 1024;
const CDP_PATH = /^\/panes\/([^/]+)\/cdp$/;

let server: Server | null = null;
const openQueues = new Map<string, Promise<void>>();
const openDepth = new Map<string, number>();
const MAX_QUEUED_OPENS = 8;

function isAuthorized(secret: string, req: IncomingMessage): boolean {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
	const candidate = bearer ?? url.searchParams.get("token") ?? "";
	const a = Buffer.from(candidate);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}

function requireScope(
	req: Request,
	res: Response,
): { paneId: string; workspaceId: string } | null {
	const paneId = req.params.paneId as string;
	const raw = req.body?.workspaceId ?? req.query.workspaceId;
	if (typeof raw !== "string" || raw.length === 0) {
		res.status(400).json({ error: "workspaceId is required" });
		return null;
	}
	return { paneId, workspaceId: raw };
}

function hasPane(
	req: Request,
	res: Response,
): { paneId: string; workspaceId: string } | null {
	const scope = requireScope(req, res);
	if (!scope) return null;
	if (!browserManager.getPane(scope.paneId, scope.workspaceId)) {
		res
			.status(404)
			.json({ error: `No live pane ${scope.paneId} in this workspace` });
		return null;
	}
	return scope;
}

export async function startBrowserBridge(): Promise<void> {
	if (server) return;
	const secret = randomBytes(32).toString("hex");
	const app = express();
	app.use(express.json({ limit: "2mb" }));
	app.use((req, res, next) => {
		if (!isAuthorized(secret, req)) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}
		next();
	});

	app.get("/panes", async (req, res) => {
		const workspaceId =
			typeof req.query.workspaceId === "string"
				? req.query.workspaceId
				: undefined;
		try {
			res.json({ panes: await browserManager.listPanesLive(workspaceId) });
		} catch (error) {
			res.status(503).json({ error: errorMessage(error) });
		}
	});

	app.post("/open", (req, res) => {
		const { workspaceId, projectId, url, target, show } = req.body ?? {};
		if (typeof workspaceId !== "string" || typeof url !== "string") {
			res.status(400).json({ error: "workspaceId and url are required" });
			return;
		}
		const resolvedTarget = target === "new-tab" ? "new-tab" : "current-tab";
		let resolvedUrl: string;
		try {
			resolvedUrl = resolveGuestUrl(url);
		} catch (err) {
			res.status(400).json({ error: errorMessage(err) });
			return;
		}
		if ((openDepth.get(workspaceId) ?? 0) >= MAX_QUEUED_OPENS) {
			res.status(429).json({
				error: "Too many pending browser-open requests for this workspace.",
			});
			return;
		}

		const run = () =>
			new Promise<void>((resolveOpen) => {
				const requestId = randomBytes(8).toString("hex");
				const known = new Set(
					browserManager.listPanes(workspaceId).map((p) => p.paneId),
				);
				let settled = false;
				const finish = (fn: () => void) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					browserManager.off("pane-registered", onRegistered);
					fn();
					resolveOpen();
				};
				const timer = setTimeout(
					() =>
						finish(() =>
							res.status(504).json({
								error: "No browser pane appeared for this workspace.",
							}),
						),
					OPEN_PANE_TIMEOUT_MS,
				);
				res.on("close", () => finish(() => {}));
				const onRegistered = (event: {
					paneId: string;
					workspaceId: string | null;
				}) => {
					if (event.workspaceId !== workspaceId || known.has(event.paneId))
						return;
					const info = browserManager
						.listPanes(workspaceId)
						.find((p) => p.paneId === event.paneId);
					finish(() =>
						res.json({
							paneId: event.paneId,
							url: info?.url ?? resolvedUrl,
							title: info?.title ?? "",
						}),
					);
				};
				browserManager.on("pane-registered", onRegistered);
				browserManager.requestOpen({
					workspaceId,
					projectId: typeof projectId === "string" ? projectId : null,
					url: resolvedUrl,
					target: resolvedTarget,
					show: show === true,
					requestId,
				} satisfies BrowserOpenRequest);
			});
		openDepth.set(workspaceId, (openDepth.get(workspaceId) ?? 0) + 1);
		const prev = openQueues.get(workspaceId) ?? Promise.resolve();
		const next = prev.then(run, run);
		openQueues.set(workspaceId, next);
		void next.finally(() => {
			openDepth.set(workspaceId, (openDepth.get(workspaceId) ?? 1) - 1);
			if ((openDepth.get(workspaceId) ?? 0) <= 0) openDepth.delete(workspaceId);
			if (openQueues.get(workspaceId) === next) openQueues.delete(workspaceId);
		});
	});

	app.post("/panes/:paneId/navigate", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		if (typeof req.body?.url !== "string") {
			res.status(400).json({ error: "url is required" });
			return;
		}
		try {
			await browserManager.navigate(
				scope.paneId,
				req.body.url,
				scope.workspaceId,
			);
			res.json({ ok: true });
		} catch (err) {
			res.status(400).json({ error: errorMessage(err) });
		}
	});

	app.post("/panes/:paneId/back", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		try {
			await browserManager.goBack(scope.paneId, scope.workspaceId);
			res.json({ ok: true });
		} catch (err) {
			res.status(404).json({ error: errorMessage(err) });
		}
	});

	app.post("/panes/:paneId/forward", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		try {
			await browserManager.goForward(scope.paneId, scope.workspaceId);
			res.json({ ok: true });
		} catch (err) {
			res.status(404).json({ error: errorMessage(err) });
		}
	});

	app.post("/panes/:paneId/reload", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		try {
			await browserManager.reload(
				scope.paneId,
				req.body?.hard === true,
				scope.workspaceId,
			);
			res.json({ ok: true });
		} catch (err) {
			res.status(404).json({ error: errorMessage(err) });
		}
	});

	app.post("/panes/:paneId/screenshot", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		try {
			res.json({
				base64: await browserManager.capturePng(
					scope.paneId,
					scope.workspaceId,
				),
			});
		} catch (err) {
			res.status(404).json({ error: errorMessage(err) });
		}
	});

	app.post("/panes/:paneId/eval", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		if (typeof req.body?.code !== "string") {
			res.status(400).json({ error: "code is required" });
			return;
		}
		try {
			res.json({
				result: await browserManager.evaluateJS(
					scope.paneId,
					req.body.code,
					scope.workspaceId,
				),
			});
		} catch (err) {
			res.status(500).json({ error: errorMessage(err) });
		}
	});

	app.get("/panes/:paneId/console", (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		res.json({
			entries: browserManager.getConsoleLogs(scope.paneId, scope.workspaceId),
		});
	});

	app.get("/import-sources", (_req, res) =>
		res.json({ sources: listChromeImportSources() }),
	);
	app.post("/panes/:paneId/import-cookies", async (req, res) => {
		const scope = hasPane(req, res);
		if (!scope) return;
		const sourceId = req.body?.sourceId;
		if (typeof sourceId !== "string" || sourceId.length === 0) {
			res.status(400).json({ error: "sourceId is required" });
			return;
		}
		try {
			res.json(
				await browserManager.importCookiesFromPane(
					sourceId,
					scope.paneId,
					scope.workspaceId,
				),
			);
		} catch (err) {
			res.status(500).json({ error: errorMessage(err) });
		}
	});

	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_CDP_MESSAGE_BYTES,
	});
	const httpServer = await new Promise<Server>((resolve, reject) => {
		const bound = app.listen(0, "127.0.0.1", () => resolve(bound));
		bound.on("error", reject);
	});
	httpServer.on("upgrade", (req, socket, head) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const match = CDP_PATH.exec(url.pathname);
		const workspaceId = url.searchParams.get("workspaceId");
		if (!match || !workspaceId || !isAuthorized(secret, req)) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) =>
			handleCdpSocket(match[1] as string, workspaceId, ws),
		);
	});
	const address = httpServer.address();
	if (!address || typeof address === "string")
		throw new Error("Browser bridge failed to bind a port");
	server = httpServer;
	const endpoint = `http://127.0.0.1:${address.port}`;
	setBrowserBridgeInfo({ endpoint, secret });
	console.info(`[browser-bridge] listening on ${endpoint}`);
}

function handleCdpSocket(
	paneId: string,
	workspaceId: string,
	ws: WebSocket,
): void {
	let session: ReturnType<typeof browserManager.attachCdp>;
	try {
		session = browserManager.attachCdp(
			paneId,
			workspaceId,
			(payload) => {
				if (ws.readyState === ws.OPEN) ws.send(payload);
			},
			(reason) => ws.close(1011, `debugger detached: ${reason}`.slice(0, 100)),
		);
	} catch (err) {
		const code = err instanceof CdpBusyError ? 1013 : 1011;
		ws.close(code, errorMessage(err).slice(0, 100));
		return;
	}
	ws.on("message", (data) => session.send(data.toString()));
	ws.on("close", () => session.detach());
	ws.on("error", () => session.detach());
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
