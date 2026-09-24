import type { NativeEvent } from "main/native/platform";

const DEFAULT_EARLY_DEEP_LINK_CAPACITY = 128;

export class EarlyDeepLinkEventBuffer {
	private pending: NativeEvent[] = [];
	private handler: ((event: NativeEvent) => void) | null = null;

	constructor(private readonly capacity = DEFAULT_EARLY_DEEP_LINK_CAPACITY) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error("Early deep-link capacity must be a positive integer");
		}
	}

	receive(event: NativeEvent): "buffered" | "dropped-oldest" | "delivered" {
		if (this.handler) {
			this.handler(event);
			return "delivered";
		}

		const droppedOldest = this.pending.length === this.capacity;
		if (droppedOldest) this.pending.shift();
		this.pending.push(event);
		return droppedOldest ? "dropped-oldest" : "buffered";
	}

	activate(handler: (event: NativeEvent) => void): void {
		if (this.handler) return;
		this.handler = handler;
		const pending = this.pending;
		this.pending = [];
		for (const event of pending) handler(event);
	}
}

export function extractDeepLinks(payload: unknown): string[] {
	if (typeof payload === "string") return [payload];
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return [];
	const value = payload as { url?: unknown; urls?: unknown };
	if (typeof value.url === "string") return [value.url];
	return Array.isArray(value.urls)
		? value.urls.filter((url): url is string => typeof url === "string")
		: [];
}
