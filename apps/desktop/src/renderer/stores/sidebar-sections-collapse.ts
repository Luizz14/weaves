import { useCallback, useEffect } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type SidebarSectionKey =
	| "cloud"
	| "pinned"
	| "sessions"
	| "userStories"
	| "workspaces";

export const SIDEBAR_SECTIONS_COLLAPSE_STORAGE_KEY =
	"sidebar-workspaces-collapse";

const DEFAULT_COLLAPSED: Record<SidebarSectionKey, boolean> = {
	cloud: false,
	pinned: false,
	sessions: false,
	userStories: false,
	workspaces: false,
};

interface PersistedSidebarSectionsCollapseState {
	collapsed: Record<SidebarSectionKey, boolean>;
	legacyMigrationOrganizationId: string | null;
	legacyMigrationComplete: boolean;
}

interface SidebarSectionsCollapseState
	extends PersistedSidebarSectionsCollapseState {
	toggle: (section: SidebarSectionKey) => void;
}

export function migrateSidebarSectionsCollapseState(
	persisted: unknown,
	version: number,
): PersistedSidebarSectionsCollapseState {
	const saved = (
		persisted && typeof persisted === "object" ? persisted : {}
	) as {
		isCollapsed?: unknown;
		collapsed?: Partial<Record<SidebarSectionKey, unknown>>;
	};
	const collapsed = { ...DEFAULT_COLLAPSED };
	let hasLegacyChoices = false;
	if (version === 0) {
		if (typeof saved.isCollapsed === "boolean") {
			collapsed.workspaces = saved.isCollapsed;
			hasLegacyChoices = true;
		}
	} else {
		for (const section of Object.keys(collapsed) as SidebarSectionKey[]) {
			const value = saved.collapsed?.[section];
			if (typeof value === "boolean") {
				collapsed[section] = value;
				hasLegacyChoices = true;
			}
		}
	}
	return {
		collapsed,
		legacyMigrationOrganizationId: null,
		legacyMigrationComplete: !hasLegacyChoices,
	};
}

export const useSidebarSectionsCollapseStore =
	create<SidebarSectionsCollapseState>()(
		devtools(
			persist(
				(set) => ({
					collapsed: { ...DEFAULT_COLLAPSED },
					legacyMigrationOrganizationId: null,
					legacyMigrationComplete: true,
					toggle: (section) =>
						set((state) => ({
							collapsed: {
								...state.collapsed,
								[section]: !state.collapsed[section],
							},
						})),
				}),
				{
					name: SIDEBAR_SECTIONS_COLLAPSE_STORAGE_KEY,
					version: 2,
					migrate: migrateSidebarSectionsCollapseState,
					partialize: (state) => ({
						collapsed: state.collapsed,
						legacyMigrationOrganizationId: state.legacyMigrationOrganizationId,
						legacyMigrationComplete: state.legacyMigrationComplete,
					}),
				},
			),
		),
	);

export function useSidebarSectionCollapse(section: SidebarSectionKey) {
	const { activeOrganizationId, v2UserPreferences } = useCollections();
	const {
		preferences,
		toggleSidebarSectionCollapsed,
		importLegacySidebarSectionsCollapsed,
	} = useV2UserPreferences();
	const globalCollapsed = useSidebarSectionsCollapseStore(
		(state) => state.collapsed[section],
	);
	const toggleGlobal = useSidebarSectionsCollapseStore((state) => state.toggle);
	const isOrganizationSection =
		section === "workspaces" ||
		section === "sessions" ||
		section === "userStories";
	useEffect(() => {
		if (!isOrganizationSection) return;
		let disposed = false;
		const migrate = () => {
			if (
				disposed ||
				!activeOrganizationId ||
				!v2UserPreferences.isReady() ||
				!useSidebarSectionsCollapseStore.persist.hasHydrated()
			)
				return;
			const legacy = useSidebarSectionsCollapseStore.getState();
			if (
				legacy.legacyMigrationComplete ||
				(legacy.legacyMigrationOrganizationId !== null &&
					legacy.legacyMigrationOrganizationId !== activeOrganizationId)
			)
				return;
			try {
				if (legacy.legacyMigrationOrganizationId === null) {
					useSidebarSectionsCollapseStore.setState({
						legacyMigrationOrganizationId: activeOrganizationId,
					});
				}
				importLegacySidebarSectionsCollapsed({
					workspaces: legacy.collapsed.workspaces,
					sessions: legacy.collapsed.sessions,
					userStories: legacy.collapsed.userStories,
				});
				useSidebarSectionsCollapseStore.setState({
					legacyMigrationComplete: true,
				});
			} catch (error) {
				console.error("[sidebar-collapse] Legacy migration failed:", error);
			}
		};
		const unsubscribe =
			useSidebarSectionsCollapseStore.persist.onFinishHydration(migrate);
		if (!v2UserPreferences.isReady()) v2UserPreferences.onFirstReady(migrate);
		migrate();
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [
		activeOrganizationId,
		v2UserPreferences,
		isOrganizationSection,
		importLegacySidebarSectionsCollapsed,
	]);
	const isCollapsed = isOrganizationSection
		? preferences.sidebarSectionsCollapsed[section]
		: globalCollapsed;
	const toggle = useCallback(() => {
		if (isOrganizationSection) {
			toggleSidebarSectionCollapsed(section);
		} else {
			toggleGlobal(section);
		}
	}, [
		isOrganizationSection,
		section,
		toggleGlobal,
		toggleSidebarSectionCollapsed,
	]);
	return { isCollapsed, toggle };
}
