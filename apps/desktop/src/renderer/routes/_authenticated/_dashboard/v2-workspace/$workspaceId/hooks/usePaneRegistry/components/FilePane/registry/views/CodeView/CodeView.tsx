import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { editorSettingsQueryOptions } from "renderer/hooks/useEditorSettings";
import { fontSettingsQueryOptions } from "renderer/lib/font-settings";
import { useLanguageSupport } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useLanguageSupport";
import type { EditorLspStatus } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/coordinator";
import { useLspCoordinator } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp/LspProvider";
import {
	createPaneScrollStateKey,
	getPaneScrollState,
	savePaneScrollState,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/paneScrollStateCache";
import { detectLanguage } from "shared/detect-language";
import type { ViewProps } from "../../types";
import { CodeEditor } from "./components/CodeEditor";
import { LspStatus } from "./components/LspStatus";

export function CodeView({
	document,
	filePath,
	workspaceId,
	readOnly = false,
}: ViewProps) {
	const lsp = useLspCoordinator();
	const [lspStatus, setLspStatus] = useState<EditorLspStatus>(null);
	const language = detectLanguage(filePath);
	const languageSupport = useLanguageSupport(language);
	const editorSettings = useQuery(editorSettingsQueryOptions);
	const fontSettings = useQuery(fontSettingsQueryOptions);
	const editorReady =
		languageSupport !== undefined &&
		!editorSettings.isPending &&
		!fontSettings.isPending;
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
						document={readOnly ? undefined : document}
						onLspStatus={setLspStatus}
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
			{!readOnly && (
				<LspStatus status={lspStatus} retry={() => void lsp?.retry(document)} />
			)}
		</div>
	);
}
