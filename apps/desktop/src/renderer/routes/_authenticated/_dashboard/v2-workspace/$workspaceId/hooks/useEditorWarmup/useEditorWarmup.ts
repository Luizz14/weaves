import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { editorSettingsQueryOptions } from "renderer/hooks/useEditorSettings";
import { fontSettingsQueryOptions } from "renderer/lib/font-settings";
import { detectLanguage } from "shared/detect-language";
import { loadLanguageSupport } from "../../utils/loadLanguageSupport";

const ALWAYS_WARM_LANGUAGES = ["typescript"];

export function useEditorWarmup(openFilePaths: Set<string>): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		void queryClient.prefetchQuery(editorSettingsQueryOptions);
		void queryClient.prefetchQuery(fontSettingsQueryOptions);
	}, [queryClient]);

	const languages = [
		...new Set([
			...ALWAYS_WARM_LANGUAGES,
			...[...openFilePaths].map((path) => detectLanguage(path)),
		]),
	]
		.sort()
		.join("\n");
	useEffect(() => {
		const handle = requestIdleCallback(
			() => {
				for (const language of languages.split("\n"))
					void loadLanguageSupport(language).catch(() => undefined);
			},
			{ timeout: 2000 },
		);
		return () => cancelIdleCallback(handle);
	}, [languages]);
}
