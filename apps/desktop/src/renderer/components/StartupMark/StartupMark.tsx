import { useEffect } from "react";
import { markRendererStartup } from "renderer/lib/startup-diagnostics";
import type { RendererStartupMarker } from "shared/startup-diagnostics";

export function StartupMark({ marker }: { marker: RendererStartupMarker }) {
	useEffect(() => {
		markRendererStartup(marker);
	}, [marker]);
	return null;
}
