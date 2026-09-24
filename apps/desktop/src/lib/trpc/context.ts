import { getNativeWindow, type NativeWindowHandle } from "main/native/platform";

/**
 * Per-call tRPC context for the native Node service.
 *
 * `senderWindow` is the trusted native window represented by the label Rust
 * attached to the request. This is what lets window-scoped procedures (e.g.
 * the per-window active organization) act on the exact window that called them
 * rather than on a single global "current" window.
 *
 * Rust never forwards requests from guest webviews or remote documents, so a
 * non-null label always denotes a top-level app renderer.
 */
export interface TrpcContext {
	senderWindow: NativeWindowHandle | null;
	windowLabel: string | null;
}

export type NativeWindowContext = TrpcContext;

export async function createTrpcContext(
	windowLabel: string | null | undefined,
): Promise<TrpcContext> {
	const trustedLabel = windowLabel ?? null;
	return {
		senderWindow: trustedLabel ? getNativeWindow(trustedLabel) : null,
		windowLabel: trustedLabel,
	};
}
