import { useRef } from "react";
import type { GatedFeature } from "./constants";

export function usePaywall() {
	const resolving = useRef(new Set<GatedFeature>());

	function hasAccess(_feature: GatedFeature): boolean {
		return true;
	}

	function gateFeature(
		feature: GatedFeature,
		callback: () => void | Promise<void>,
		_context?: Record<string, unknown>,
	): void {
		if (resolving.current.has(feature)) return;
		resolving.current.add(feature);
		void (async () => {
			try {
				await callback();
			} catch (error) {
				console.error(`[feature action] Callback error for ${feature}:`, error);
			} finally {
				resolving.current.delete(feature);
			}
		})();
	}

	return {
		hasAccess,
		gateFeature,
		isReady: true,
	};
}
