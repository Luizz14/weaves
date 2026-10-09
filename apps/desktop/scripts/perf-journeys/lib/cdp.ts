export interface CdpTarget {
	id: string;
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

type EventHandler = (params: Record<string, unknown>) => void;

export class CdpClosedError extends Error {}

export class Cdp {
	private nextId = 0;
	private pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private handlers = new Map<string, Set<EventHandler>>();
	private closed = false;

	private constructor(private ws: WebSocket) {
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				method?: string;
				params?: Record<string, unknown>;
				result?: unknown;
				error?: { message: string };
			};
			if (message.id == null) {
				if (!message.method) return;
				for (const handler of this.handlers.get(message.method) ?? []) {
					handler(message.params ?? {});
				}
				return;
			}
			const entry = this.pending.get(message.id);
			if (!entry) return;
			this.pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error) entry.reject(new Error(message.error.message));
			else entry.resolve(message.result);
		});
		ws.addEventListener("close", () => {
			this.closed = true;
			for (const [id, entry] of this.pending) {
				clearTimeout(entry.timer);
				entry.reject(new CdpClosedError(`CDP socket closed (request ${id})`));
			}
			this.pending.clear();
		});
	}

	static async connect(url: string): Promise<Cdp> {
		const ws = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve(), { once: true });
			ws.addEventListener("error", () => reject(new Error("CDP ws error")), {
				once: true,
			});
		});
		return new Cdp(ws);
	}

	get isClosed(): boolean {
		return this.closed;
	}

	send<T>(
		method: string,
		params: Record<string, unknown> = {},
		timeoutMs = 20_000,
	): Promise<T> {
		if (this.closed) {
			return Promise.reject(new CdpClosedError(`CDP closed: ${method}`));
		}
		const id = ++this.nextId;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id))
					reject(new Error(`CDP timeout: ${method}`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	async eval<T>(expression: string, timeoutMs = 20_000): Promise<T> {
		const response = await this.send<{
			result?: { value?: T };
			exceptionDetails?: { text: string; exception?: { description?: string } };
		}>(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			timeoutMs,
		);
		if (response.exceptionDetails) {
			throw new Error(
				response.exceptionDetails.exception?.description ??
					response.exceptionDetails.text,
			);
		}
		return response.result?.value as T;
	}

	on(method: string, handler: EventHandler): () => void {
		let set = this.handlers.get(method);
		if (!set) {
			set = new Set();
			this.handlers.set(method, set);
		}
		set.add(handler);
		return () => set.delete(handler);
	}

	close(): void {
		this.ws.close();
	}
}

export async function listTargets(port: number): Promise<CdpTarget[]> {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`);
	return (await response.json()) as CdpTarget[];
}
