import { useCallback, useMemo } from "react";
import {
	createPaneScrollStateKey,
	getPaneScrollState,
	savePaneScrollState,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/paneScrollStateCache";
import { detectLanguage } from "shared/detect-language";
import type { ViewProps } from "../../types";
import { CodeEditor } from "./components/CodeEditor";

export function CodeView({
	document,
	filePath,
	workspaceId,
	readOnly = false,
}: ViewProps) {
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
		<CodeEditor
			key={document.id}
			value={document.content.value}
			readOnly={readOnly}
			language={detectLanguage(filePath)}
			onChange={(next) => document.setContent(next)}
			onSave={readOnly ? undefined : () => void document.save()}
			initialScrollPosition={initialScrollPosition}
			onScrollPositionChange={handleScrollPositionChange}
			fillHeight
		/>
	);
}
