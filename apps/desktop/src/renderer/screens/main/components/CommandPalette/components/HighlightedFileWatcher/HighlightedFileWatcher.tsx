import { useCommandState } from "@superset/ui/command";
import { useEffect } from "react";

const RECENT_PREFIX = "recent:";

export function HighlightedFileWatcher({
	onChange,
}: {
	onChange: (absolutePath: string | null) => void;
}) {
	const value = useCommandState((state) => state.value);
	useEffect(() => {
		onChange(
			value
				? value.startsWith(RECENT_PREFIX)
					? value.slice(RECENT_PREFIX.length)
					: value
				: null,
		);
	}, [value, onChange]);
	return null;
}
