import type { Extension } from "@codemirror/state";
import { useEffect, useSyncExternalStore } from "react";
import {
	loadLanguageSupport,
	peekLanguageSupport,
	subscribeLanguageSupport,
} from "../../utils/loadLanguageSupport";

export function useLanguageSupport(
	language: string,
): Extension | null | undefined {
	const support = useSyncExternalStore(subscribeLanguageSupport, () =>
		peekLanguageSupport(language),
	);
	useEffect(() => {
		if (support !== undefined) return;
		void loadLanguageSupport(language).catch((error) => {
			console.error("[CodeEditor] Failed to load language support:", {
				error,
				language,
			});
		});
	}, [language, support]);
	return support;
}
