import type { Transport } from "@codemirror/lsp-client";

export class LspTransport implements Transport {
	private handlers = new Set<(message: string) => void>();
	private pending = new Map<number, ReturnType<typeof setTimeout>>();
	private closed = false;

	constructor(private socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			const value: unknown = JSON.parse(event.data);
			if (
				value &&
				typeof value === "object" &&
				"id" in value &&
				typeof value.id === "number" &&
				!("method" in value)
			) {
				clearTimeout(this.pending.get(value.id));
				this.pending.delete(value.id);
			}
			this.emit(event.data);
		});
		socket.addEventListener("close", () => this.dispose());
	}

	private emit(message: string) {
		for (const handler of this.handlers) handler(message);
	}

	send(message: string) {
		if (this.closed || this.socket.readyState !== WebSocket.OPEN)
			throw new Error("Language server disconnected");
		const value: unknown = JSON.parse(message);
		if (
			value &&
			typeof value === "object" &&
			"id" in value &&
			typeof value.id === "number" &&
			"method" in value
		) {
			const id = value.id;
			const timer = setTimeout(
				() => {
					this.pending.delete(id);
					this.emit(
						JSON.stringify({
							jsonrpc: "2.0",
							id,
							error: {
								code: -32800,
								message: "Language server request timed out",
							},
						}),
					);
					if (this.socket.readyState === WebSocket.OPEN)
						this.socket.send(
							JSON.stringify({
								jsonrpc: "2.0",
								method: "$/cancelRequest",
								params: { id },
							}),
						);
				},
				value.method === "initialize" ? 120_000 : 10_000,
			);
			this.pending.set(id, timer);
		}
		this.socket.send(message);
	}

	subscribe(handler: (message: string) => void) {
		this.handlers.add(handler);
	}
	unsubscribe(handler: (message: string) => void) {
		this.handlers.delete(handler);
	}

	dispose() {
		if (this.closed) return;
		this.closed = true;
		for (const [id, timer] of this.pending) {
			clearTimeout(timer);
			this.emit(
				JSON.stringify({
					jsonrpc: "2.0",
					id,
					error: { code: -32800, message: "Language server disconnected" },
				}),
			);
		}
		this.pending.clear();
		this.handlers.clear();
	}
}
