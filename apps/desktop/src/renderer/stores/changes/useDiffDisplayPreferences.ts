import { useShallow } from "zustand/react/shallow";
import { useChangesStore } from "./store";

export function useDiffDisplayPreferences() {
	return useChangesStore(
		useShallow((state) => ({
			viewMode: state.viewMode,
			setViewMode: state.setViewMode,
			hideUnchangedRegions: state.hideUnchangedRegions,
			toggleHideUnchangedRegions: state.toggleHideUnchangedRegions,
		})),
	);
}
