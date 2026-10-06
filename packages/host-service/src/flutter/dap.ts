import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { treeKillWithEscalation } from "../ports/tree-kill";

export interface DapMessage {
	type: string;
	seq?: number;
	request_seq?: number;
	command?: string;
	event?: string;
	success?: boolean;
	message?: string;
	body?: Record<string, unknown>;
}
export class DapFrames {
	private buffer = Buffer.alloc(0);
	push(chunk: Buffer): DapMessage[] {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		if (this.buffer.length > 16 * 1024 * 1024)
			throw new Error("DAP buffer exceeds limit");
		const messages: DapMessage[] = [];
		while (true) {
			const end = this.buffer.indexOf("\r\n\r\n");
			if (end < 0) break;
			const length = Number(
				/Content-Length:\s*(\d+)/i.exec(
					this.buffer.subarray(0, end).toString(),
				)?.[1],
			);
			if (!Number.isInteger(length) || length < 0 || length > 16 * 1024 * 1024)
				throw new Error("Invalid DAP Content-Length");
			if (this.buffer.length < end + 4 + length) break;
			const message = JSON.parse(
				this.buffer.subarray(end + 4, end + 4 + length).toString("utf8"),
			) as DapMessage;
			this.buffer = this.buffer.subarray(end + 4 + length);
			messages.push(message);
		}
		return messages;
	}
}
export class FlutterDap extends EventEmitter {
	readonly child: ChildProcessWithoutNullStreams;
	private sequence = 0;
	private pending = new Map<
		number,
		{
			resolve: (body: Record<string, unknown>) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private closed = false;
	constructor(command: string, cwd: string, env: Record<string, string>) {
		super();
		this.child = spawn(command, ["debug-adapter"], {
			cwd,
			env,
			stdio: "pipe",
			shell: process.platform === "win32",
		});
		const frames = new DapFrames();
		this.child.stdout.on("data", (chunk: Buffer) => {
			try {
				for (const message of frames.push(chunk)) this.receive(message);
			} catch (error) {
				this.emit("failure", error);
				void this.stop();
			}
		});
		this.child.stdin.on("error", (error) => {
			this.emit("failure", error);
			this.finish(error);
		});
		this.child.stderr.on("data", (chunk: Buffer) =>
			this.emit("output", chunk.toString()),
		);
		this.child.on("error", (error) => {
			this.emit("failure", error);
			this.finish(error);
		});
		this.child.on("close", (code) => {
			this.finish(new Error("Debug adapter exited"));
			this.emit("exit", code);
		});
	}
	private send(value: object) {
		const body = Buffer.from(JSON.stringify(value));
		this.child.stdin.write(
			Buffer.concat([
				Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
				body,
			]),
		);
	}
	private receive(message: DapMessage) {
		if (message.type === "response" && message.request_seq !== undefined) {
			const pending = this.pending.get(message.request_seq);
			if (!pending) return;
			this.pending.delete(message.request_seq);
			clearTimeout(pending.timer);
			if (message.success === false)
				pending.reject(new Error(message.message ?? "DAP request failed"));
			else pending.resolve(message.body ?? {});
		} else if (message.type === "request")
			this.send({
				type: "response",
				seq: ++this.sequence,
				request_seq: message.seq,
				command: message.command,
				success: false,
				message: "Reverse request not supported",
			});
		else if (message.type === "event")
			this.emit("event", message.event, message.body ?? {});
	}
	request(
		command: string,
		args: object = {},
		timeout = 30_000,
	): Promise<Record<string, unknown>> {
		if (this.closed)
			return Promise.reject(new Error("Debug adapter is closed"));
		const seq = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(seq);
				reject(new Error(`DAP ${command} timed out`));
			}, timeout);
			this.pending.set(seq, { resolve, reject, timer });
			this.send({ seq, type: "request", command, arguments: args });
		});
	}
	private finish(error: Error) {
		this.closed = true;
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.pending.clear();
	}
	async stop() {
		if (!this.closed)
			await this.request(
				"disconnect",
				{ terminateDebuggee: true },
				5_000,
			).catch(() => {});
		this.finish(new Error("Debug adapter stopped"));
		if (this.child.pid)
			await treeKillWithEscalation({
				pid: this.child.pid,
				escalationTimeoutMs: 1000,
			});
	}
}
