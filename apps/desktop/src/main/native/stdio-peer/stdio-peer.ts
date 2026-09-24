import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";

export const MAX_NATIVE_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_REQUESTS = 256;
const jsonValueSchema = z.unknown().refine((value) => value !== undefined);

const messageSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("request"),
			id: z.string(),
			method: z.string(),
			params: jsonValueSchema,
			windowLabel: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("response"),
			id: z.string(),
			value: jsonValueSchema,
		})
		.strict(),
	z
		.object({ type: z.literal("error"), id: z.string(), message: z.string() })
		.strict(),
	z
		.object({
			type: z.literal("event"),
			name: z.string(),
			payload: jsonValueSchema,
			windowLabel: z.string().optional(),
		})
		.strict(),
]);

export type NativeMessage = z.infer<typeof messageSchema>;
export type NativeRequest = Extract<NativeMessage, { type: "request" }>;
type NativeEvent = Extract<NativeMessage, { type: "event" }>;
type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
};

export class StdioPeer {
	private readonly pending = new Map<string, PendingRequest>();
	private readonly listeners = new Set<(event: NativeEvent) => void>();
	private fragments: Buffer[] = [];
	private frameBytes = 0;
	private closed = false;
	private activeRequests = 0;

	constructor(
		private readonly input: Readable,
		private readonly output: Writable,
		private readonly handleRequest: (
			request: NativeRequest,
		) => Promise<unknown>,
		private readonly onClose: (error: Error) => void = () => {},
	) {
		input.on("data", this.onData);
		input.once("end", this.onEnd);
		input.once("close", this.onEnd);
		input.once("error", this.onTransportError);
		output.once("error", this.onTransportError);
		output.once("close", this.onEnd);
	}

	request(
		method: string,
		params: unknown,
		timeoutMs: number | null = 30_000,
		windowLabel?: string,
	): Promise<unknown> {
		if (this.closed)
			return Promise.reject(new Error("Native transport is closed"));
		if (this.pending.size >= MAX_PENDING_REQUESTS)
			return Promise.reject(new Error("Native request queue is full"));
		if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
			return Promise.reject(new Error("Invalid native request timeout"));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer =
				timeoutMs === null
					? null
					: setTimeout(() => {
							this.pending.delete(id);
							reject(new Error(`Native request timed out: ${method}`));
						}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.send({
					type: "request",
					id,
					method,
					params: params ?? null,
					windowLabel,
				});
			} catch (error) {
				if (timer !== null) clearTimeout(timer);
				this.pending.delete(id);
				reject(error);
			}
		});
	}

	subscribe(listener: (event: NativeEvent) => void): () => void {
		if (this.closed) throw new Error("Native transport is closed");
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(name: string, payload: unknown, windowLabel?: string): void {
		this.send({ type: "event", name, payload: payload ?? null, windowLabel });
	}

	close(error = new Error("Native transport closed")): void {
		if (this.closed) return;
		this.closed = true;
		this.input.off("data", this.onData);
		this.input.off("end", this.onEnd);
		this.input.off("close", this.onEnd);
		this.listeners.clear();
		this.fragments = [];
		this.frameBytes = 0;
		for (const pending of this.pending.values()) {
			if (pending.timer !== null) clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.onClose(error);
	}

	private readonly onEnd = () => {
		this.close(
			new Error(
				this.frameBytes ? "Incomplete native frame" : "Native transport closed",
			),
		);
	};

	private readonly onTransportError = () => {
		this.close(new Error("Native transport failed"));
	};

	private readonly onData = (data: Buffer | string): void => {
		const bytes = typeof data === "string" ? Buffer.from(data) : data;
		let offset = 0;
		while (!this.closed && offset < bytes.length) {
			const newline = bytes.indexOf(10, offset);
			const end = newline === -1 ? bytes.length : newline + 1;
			const fragment = bytes.subarray(offset, end);
			this.frameBytes += fragment.length;
			if (this.frameBytes > MAX_NATIVE_FRAME_BYTES) {
				this.close(new Error("Native frame exceeds limit"));
				return;
			}
			this.fragments.push(fragment);
			offset = end;
			if (newline === -1) return;
			const frame = Buffer.concat(this.fragments, this.frameBytes);
			this.fragments = [];
			this.frameBytes = 0;
			let message: NativeMessage;
			try {
				message = messageSchema.parse(JSON.parse(frame.toString("utf8")));
			} catch {
				this.close(new Error("Invalid native frame"));
				return;
			}
			try {
				this.receive(message);
			} catch {
				this.close(new Error("Native event handler failed"));
			}
		}
	};

	private receive(message: NativeMessage): void {
		if (message.type === "response" || message.type === "error") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (pending.timer !== null) clearTimeout(pending.timer);
			if (message.type === "response") pending.resolve(message.value);
			else pending.reject(new Error(message.message));
			return;
		}
		if (message.type === "event") {
			for (const listener of this.listeners) listener(message);
			return;
		}
		if (this.activeRequests >= MAX_PENDING_REQUESTS) {
			this.close(new Error("Native incoming request queue is full"));
			return;
		}
		this.activeRequests++;
		void this.respond(message);
	}

	private async respond(request: NativeRequest): Promise<void> {
		let reply: NativeMessage;
		try {
			const value = await this.handleRequest(request);
			reply = { type: "response", id: request.id, value: value ?? null };
		} catch (error) {
			reply = {
				type: "error",
				id: request.id,
				message:
					error instanceof Error ? error.message : "Native request failed",
			};
		} finally {
			this.activeRequests--;
		}
		if (this.closed) return;
		try {
			this.send(reply);
		} catch {
			this.close(new Error("Native response could not be delivered"));
		}
	}

	private send(message: NativeMessage): void {
		if (this.closed) throw new Error("Native transport is closed");
		const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
		if (bytes.length > MAX_NATIVE_FRAME_BYTES)
			throw new Error("Native frame exceeds limit");
		if (this.output.writableLength + bytes.length > MAX_NATIVE_FRAME_BYTES) {
			throw new Error("Native output queue is full");
		}
		this.output.write(bytes);
	}
}
