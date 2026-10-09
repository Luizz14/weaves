import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { treeKillWithEscalation } from "../ports/tree-kill";

export class ToolService extends EventEmitter {
	readonly child: ChildProcessWithoutNullStreams;
	private text = "";
	constructor(
		command: string,
		args: string[],
		cwd: string,
		env: Record<string, string>,
	) {
		super();
		this.child = spawn(command, args, {
			cwd,
			env,
			stdio: "pipe",
			shell: false,
		});
		this.child.stdout.on("data", (chunk: Buffer) => {
			this.text += chunk.toString();
			if (this.text.length > 1024 * 1024) {
				this.emit("failure", new Error("Service output exceeds limit"));
				void this.stop().catch(() => {});
				return;
			}
			let end = this.text.indexOf("\n");
			while (end >= 0) {
				const line = this.text.slice(0, end).trim();
				this.text = this.text.slice(end + 1);
				try {
					this.emit("message", JSON.parse(line));
				} catch {}
				end = this.text.indexOf("\n");
			}
		});
		this.child.stderr.on("data", () => {});
		this.child.on("error", (error) => this.emit("failure", error));
		this.child.on("close", () =>
			this.emit("failure", new Error("SDK service exited")),
		);
	}
	wait(
		predicate: (message: Record<string, unknown>) => string | undefined,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				this.off("message", onMessage);
				this.off("failure", onError);
			};
			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};
			const onMessage = (input: unknown) => {
				if (input && typeof input === "object") {
					const result = predicate(input as Record<string, unknown>);
					if (result) {
						cleanup();
						resolve(result);
					}
				}
			};
			const timer = setTimeout(
				() => onError(new Error("SDK service startup timed out")),
				20_000,
			);
			this.on("message", onMessage);
			this.on("failure", onError);
		});
	}
	async stop() {
		if (this.child.pid)
			await treeKillWithEscalation({
				pid: this.child.pid,
				escalationTimeoutMs: 500,
			});
	}
}
export class DtdConnection {
	private socket: WebSocket;
	private sequence = 0;
	private pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	readonly ready: Promise<void>;
	constructor(
		uri: string,
		private onNavigate: (
			params: Record<string, unknown>,
		) => void | Promise<void>,
		private onNotification?: (message: Record<string, unknown>) => void,
	) {
		this.socket = new WebSocket(uri);
		this.ready = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("DTD connection timed out"));
				this.close();
			}, 10000);
			this.socket.addEventListener(
				"open",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			this.socket.addEventListener(
				"error",
				() => {
					clearTimeout(timer);
					reject(new Error("DTD connection failed"));
				},
				{ once: true },
			);
		});
		this.socket.addEventListener("message", (event) => {
			try {
				this.receive(JSON.parse(String(event.data)));
			} catch {}
		});
		this.socket.addEventListener("close", () => this.close());
	}
	private receive(message: Record<string, unknown>) {
		if (typeof message.id === "number" && this.pending.has(message.id)) {
			const task = this.pending.get(message.id);
			if (!task) return;
			clearTimeout(task.timer);
			this.pending.delete(message.id);
			if (message.error) task.reject(new Error("DTD request failed"));
			else task.resolve(message.result);
		} else if (message.method === "Editor.navigateToCode") {
			void Promise.resolve()
				.then(() =>
					this.onNavigate((message.params ?? {}) as Record<string, unknown>),
				)
				.then(
					() => {
						if (this.socket.readyState === 1)
							this.socket.send(
								JSON.stringify({
									jsonrpc: "2.0",
									id: message.id,
									result: { type: "Success" },
								}),
							);
					},
					() => {
						if (this.socket.readyState === 1)
							this.socket.send(
								JSON.stringify({
									jsonrpc: "2.0",
									id: message.id,
									error: { code: -32602, message: "Invalid source location" },
								}),
							);
					},
				);
		} else if (message.id === undefined) this.onNotification?.(message);
		else if (message.id !== undefined)
			this.socket.send(
				JSON.stringify({
					jsonrpc: "2.0",
					id: message.id,
					error: { code: -32601, message: "Unsupported IDE method" },
				}),
			);
	}
	async call(method: string, params: object) {
		await this.ready;
		const id = ++this.sequence;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("DTD request timed out"));
			}, 10_000);
			this.pending.set(id, { resolve, reject, timer });
			this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		});
	}
	close() {
		for (const task of this.pending.values()) {
			clearTimeout(task.timer);
			task.reject(new Error("DTD closed"));
		}
		this.pending.clear();
		if (this.socket.readyState < 2) this.socket.close();
	}
}
