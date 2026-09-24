import { invokeNative } from "main/native/platform";

/**
 * Retained for callers that used the old factory name. The lock is now owned
 * by the Rust application process and the callback runs only for the primary
 * instance.
 */
export async function makeAppWithSingleInstanceLock(
	fn: () => void | Promise<void>,
): Promise<void> {
	const primary = await invokeNative<boolean>("app.requestSingleInstanceLock");
	if (!primary) {
		await invokeNative("app.exit", { code: 0 });
		return;
	}
	await fn();
}
