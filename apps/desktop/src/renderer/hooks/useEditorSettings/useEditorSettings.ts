import {
	DEFAULT_EDITOR_SETTINGS,
	type EditorSettings,
} from "@superset/shared/editor-settings";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export const EDITOR_SETTINGS_QUERY_KEY = [
	"electron",
	"settings",
	"editor",
] as const;
export const editorSettingsQueryOptions = queryOptions({
	queryKey: EDITOR_SETTINGS_QUERY_KEY,
	queryFn: () => electronTrpcClient.settings.editor.get.query(),
	staleTime: 5000,
});

export function useEditorSettings(): EditorSettings {
	const query = useQuery(editorSettingsQueryOptions);
	return query.data ?? DEFAULT_EDITOR_SETTINGS;
}
