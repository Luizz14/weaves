import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { usePaywall } = await import("./usePaywall");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

test("all feature access is available regardless of subscription", () => {
	const { result } = renderHook(() => usePaywall());
	expect(result.current.isReady).toBe(true);
	expect(result.current.hasAccess("automations")).toBe(true);
	expect(result.current.hasAccess("tasks")).toBe(true);
});

test("runs the feature action once for repeated clicks while it is pending", async () => {
	const { result } = renderHook(() => usePaywall());
	let finish!: () => void;
	const callback = mock(
		() => new Promise<void>((resolve) => (finish = resolve)),
	);

	act(() => {
		result.current.gateFeature("automations", callback);
		result.current.gateFeature("automations", callback);
	});
	expect(callback).toHaveBeenCalledTimes(1);

	await act(async () => finish());
	act(() => result.current.gateFeature("automations", callback));
	expect(callback).toHaveBeenCalledTimes(2);
});
