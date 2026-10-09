import { Trans } from "@lingui/react/macro";
import {
	DEFAULT_EDITOR_SETTINGS,
	resolveEditorSettings,
} from "@superset/shared/editor-settings";
import { detectLspLanguage } from "@superset/shared/lsp";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { editorSettingsQueryOptions } from "renderer/hooks/useEditorSettings";
import { fontSettingsQueryOptions } from "renderer/lib/font-settings";
import { useLanguageSupport } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useLanguageSupport";
import { useLspCoordinator } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/LspProvider";
import {
	createPaneScrollStateKey,
	getPaneScrollState,
	savePaneScrollState,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/paneScrollStateCache";
import { detectLanguage } from "shared/detect-language";
import type { ViewProps } from "../../types";
import { CodeEditor } from "./components/CodeEditor";

function subscribeNothing() {
	return () => {};
}

export function CodeView({
	paneId,
	document,
	filePath,
	workspaceId,
	readOnly = false,
}: ViewProps) {
	const lsp = useLspCoordinator();
	const language = detectLanguage(filePath);
	const languageSupport = useLanguageSupport(language);
	const editorSettings = useQuery(editorSettingsQueryOptions);
	const fontSettings = useQuery(fontSettingsQueryOptions);
	const editorReady =
		languageSupport !== undefined &&
		!editorSettings.isPending &&
		!fontSettings.isPending;
	const lspEligible =
		!!lsp &&
		!readOnly &&
		detectLspLanguage(document.absolutePath) !== null &&
		resolveEditorSettings(
			editorSettings.data ?? DEFAULT_EDITOR_SETTINGS,
			language,
		).enableLanguageServer;
	const lspStatus = useSyncExternalStore(
		lsp?.subscribeStatus ?? subscribeNothing,
		() =>
			lspEligible && lsp
				? lsp.getStatus(document.id, document.absolutePath)
				: null,
	);
	const reserveLintGutter =
		lspStatus !== null &&
		lspStatus.state !== "missing" &&
		lspStatus.state !== "disabled";
	// Quick Open replaces preview panes with new pane IDs, so the file path is
	// the stable editor identity when a user switches away and back.
	const scrollStateKey = useMemo(
		() =>
			createPaneScrollStateKey({
				workspaceId,
				viewId: "editor",
				resourceId: readOnly ? document.id : filePath,
			}),
		[workspaceId, filePath, readOnly, document.id],
	);
	const initialScrollPosition = useMemo(
		() => getPaneScrollState(scrollStateKey),
		[scrollStateKey],
	);
	const handleScrollPositionChange = useCallback(
		(position: { scrollTop: number; scrollLeft: number }) => {
			savePaneScrollState(scrollStateKey, position);
		},
		[scrollStateKey],
	);

	if (document.content.kind !== "text") {
		return null;
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">
				{editorReady && (
					<CodeEditor
						paneId={paneId}
						document={readOnly ? undefined : document}
						lintGutter={reserveLintGutter}
						key={document.id}
						value={document.content.value}
						readOnly={readOnly}
						language={language}
						onChange={(next) => document.setContent(next)}
						onSave={readOnly ? undefined : () => void document.save()}
						initialScrollPosition={initialScrollPosition}
						onScrollPositionChange={handleScrollPositionChange}
						fillHeight
					/>
				)}
			</div>
			{document.formatWarning && (
				<output className="border-t px-3 py-1 text-xs text-muted-foreground">
					<Trans>
						Saved without formatting. Check the project formatter or language
						server.
					</Trans>
				</output>
			)}
		</div>
	);
}
