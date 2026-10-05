import { useChangesStore } from "renderer/stores/changes";
import { useShallow } from "zustand/react/shallow";

export function useChangesSidebarState(workspaceId: string | undefined) {
	return useChangesStore(
		useShallow((state) => ({
			expandedSections: state.expandedSections,
			fileListViewMode: state.fileListViewMode,
			sectionOrder: state.sectionOrder,
			selectFile: state.selectFile,
			selectedFileState: state.selectedFiles[workspaceId ?? ""] ?? null,
			setActiveTab: state.setActiveTab,
			toggleSection: state.toggleSection,
			moveSection: state.moveSection,
			setFileListViewMode: state.setFileListViewMode,
		})),
	);
}
