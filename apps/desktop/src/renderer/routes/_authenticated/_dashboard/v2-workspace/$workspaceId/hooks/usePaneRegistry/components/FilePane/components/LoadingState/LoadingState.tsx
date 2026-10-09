import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

const SHOW_AFTER_MS = 800;

export function LoadingState() {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
			{visible && <Trans>Loading…</Trans>}
		</div>
	);
}
