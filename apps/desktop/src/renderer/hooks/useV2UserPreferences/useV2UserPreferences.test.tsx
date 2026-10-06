import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { type ReactNode, StrictMode } from "react";
import {
	DEFAULT_V2_USER_PREFERENCES,
	healV2UserPreferences,
	type OrganizationSidebarSectionKey,
	V2_USER_PREFERENCES_ID,
	type V2UserPreferencesRow,
	v2UserPreferencesSchema,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { withReadHeal } from "renderer/routes/_authenticated/providers/CollectionsProvider/withReadHeal";
import { createJSONStorage, type StorageValue } from "zustand/middleware";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const reactDb = await import("@tanstack/react-db");
const originalUseLiveQuery = reactDb.useLiveQuery;
const liveQueries = new Set<
	NonNullable<ReturnType<typeof originalUseLiveQuery>["collection"]>
>();
async function cleanupQueries() {
	for (const query of liveQueries) await query.cleanup();
	liveQueries.clear();
}
let forcedRows: Array<{
	preferences: V2UserPreferencesRow;
	organizationId: string;
}> | null = null;
mock.module("@tanstack/react-db", () => ({
	...reactDb,
	useLiveQuery: (...args: Parameters<typeof reactDb.useLiveQuery>) => {
		const result = originalUseLiveQuery(...args);
		if (result.collection) liveQueries.add(result.collection);
		return forcedRows ? { ...result, data: forcedRows } : result;
	},
}));

const disk = new Map<string, string>();
const storage = {
	getItem: (key: string) => disk.get(key) ?? null,
	setItem: (key: string, value: string) => {
		disk.set(key, value);
	},
	removeItem: (key: string) => {
		disk.delete(key);
	},
};
function makeOrganization(organizationId: string) {
	const v2UserPreferences = reactDb.createCollection(
		reactDb.localStorageCollectionOptions(
			withReadHeal(
				{
					id: `v2_user_preferences-${organizationId}`,
					storageKey: `v2-user-preferences-${organizationId}`,
					schema: v2UserPreferencesSchema,
					getKey: (item: V2UserPreferencesRow) => item.id as string,
					storage,
					storageEventApi: {
						addEventListener: () => {},
						removeEventListener: () => {},
					},
					startSync: true,
				},
				healV2UserPreferences,
			),
		),
	);
	return { activeOrganizationId: organizationId, v2UserPreferences };
}
let orgA: ReturnType<typeof makeOrganization>;
let orgB: ReturnType<typeof makeOrganization>;
let current: ReturnType<typeof makeOrganization>;
mock.module(
	"renderer/routes/_authenticated/providers/CollectionsProvider",
	() => ({
		useCollections: () => current,
	}),
);
const { useV2UserPreferences } = await import("./useV2UserPreferences");
const {
	useSidebarSectionCollapse,
	useSidebarSectionsCollapseStore,
	SIDEBAR_SECTIONS_COLLAPSE_STORAGE_KEY,
	migrateSidebarSectionsCollapseState,
} = await import("renderer/stores/sidebar-sections-collapse");

const originalLegacyStorage =
	useSidebarSectionsCollapseStore.persist.getOptions().storage;
const legacyDisk = new Map<string, string>();
type LegacyStorageState = ReturnType<
	typeof migrateSidebarSectionsCollapseState
>;
const legacyStorage = createJSONStorage<LegacyStorageState>(() => ({
	getItem: (key: string) => legacyDisk.get(key) ?? null,
	setItem: (key: string, value: string) => {
		legacyDisk.set(key, value);
	},
	removeItem: (key: string) => {
		legacyDisk.delete(key);
	},
}));
async function seedLegacy(version: number, state: unknown) {
	legacyDisk.set(
		SIDEBAR_SECTIONS_COLLAPSE_STORAGE_KEY,
		JSON.stringify({ state, version }),
	);
	await useSidebarSectionsCollapseStore.persist.rehydrate();
}
async function seedOrganization(organizationId: string, row: unknown) {
	const previous = organizationId === "org-a" ? orgA : orgB;
	await previous.v2UserPreferences.cleanup();
	disk.set(
		`v2-user-preferences-${organizationId}`,
		JSON.stringify({ "s:preferences": { versionKey: "old", data: row } }),
	);
	const next = makeOrganization(organizationId);
	if (organizationId === "org-a") orgA = next;
	else orgB = next;
	if (current.activeOrganizationId === organizationId) current = next;
}
const defaults = DEFAULT_V2_USER_PREFERENCES.sidebarSectionsCollapsed;
const sections: OrganizationSidebarSectionKey[] = [
	"workspaces",
	"sessions",
	"userStories",
];

beforeEach(async () => {
	disk.clear();
	legacyDisk.clear();
	useSidebarSectionsCollapseStore.persist.setOptions({
		storage: legacyStorage,
	});
	await useSidebarSectionsCollapseStore.persist.rehydrate();
	forcedRows = null;
	orgA = makeOrganization("org-a");
	orgB = makeOrganization("org-b");
	current = orgA;
	useSidebarSectionsCollapseStore.setState({
		legacyMigrationOrganizationId: null,
		legacyMigrationComplete: true,
		collapsed: {
			cloud: false,
			pinned: false,
			workspaces: false,
			sessions: false,
			userStories: false,
		},
	});
});
afterEach(async () => {
	cleanup();
	await cleanupQueries();
	await orgA.v2UserPreferences.cleanup();
	await orgB.v2UserPreferences.cleanup();
});
afterAll(async () => {
	useSidebarSectionsCollapseStore.persist.setOptions({
		storage: originalLegacyStorage,
	});
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

test.each(
	sections,
)("%s is independent across organizations and sections", async (section) => {
	const { result, rerender } = renderHook(() => useV2UserPreferences());
	await act(async () => {
		result.current.toggleSidebarSectionCollapsed(section);
	});
	await waitFor(() =>
		expect(result.current.preferences.sidebarSectionsCollapsed).toEqual({
			...defaults,
			[section]: true,
		}),
	);
	await act(async () => {
		current = orgB;
		rerender();
	});
	expect(result.current.preferences.sidebarSectionsCollapsed).toEqual(defaults);
	const other = sections.find(
		(key) => key !== section,
	) as OrganizationSidebarSectionKey;
	await act(async () => {
		result.current.toggleSidebarSectionCollapsed(other);
	});
	await waitFor(() =>
		expect(result.current.preferences.sidebarSectionsCollapsed).toEqual({
			...defaults,
			[other]: true,
		}),
	);
	await act(async () => {
		current = orgA;
		rerender();
	});
	await waitFor(() =>
		expect(result.current.preferences.sidebarSectionsCollapsed).toEqual({
			...defaults,
			[section]: true,
		}),
	);
});

test.each([
	false,
	true,
])("ignores a delayed previous-org result and toggles the current collection (existing row: %s)", async (hasRow) => {
	orgA.v2UserPreferences.insert({
		...DEFAULT_V2_USER_PREFERENCES,
		sidebarSectionsCollapsed: {
			workspaces: true,
			sessions: true,
			userStories: true,
		},
	});
	if (hasRow)
		orgB.v2UserPreferences.insert({
			...DEFAULT_V2_USER_PREFERENCES,
			sidebarSectionsCollapsed: { ...defaults, sessions: true },
		});
	const { result, rerender } = renderHook(() => useV2UserPreferences());
	await waitFor(() =>
		expect(result.current.preferences.sidebarSectionsCollapsed.workspaces).toBe(
			true,
		),
	);
	const previous = orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID);
	if (!previous) throw new Error("Missing seeded org A preferences");
	await act(async () => {
		forcedRows = [{ preferences: previous, organizationId: "org-a" }];
		current = orgB;
		rerender();
	});
	expect(result.current.preferences.sidebarSectionsCollapsed).toEqual(defaults);
	await act(async () => {
		result.current.toggleSidebarSectionCollapsed("sessions");
	});
	expect(
		orgB.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
			?.sidebarSectionsCollapsed,
	).toEqual({ ...defaults, sessions: !hasRow });
	expect(orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toEqual(previous);
	await act(async () => {
		forcedRows = null;
		rerender();
	});
	await waitFor(() =>
		expect(result.current.preferences.sidebarSectionsCollapsed.sessions).toBe(
			!hasRow,
		),
	);
});

test("recreates collections and restores each organization's own persisted choices", async () => {
	const { result, rerender, unmount } = renderHook(() =>
		useV2UserPreferences(),
	);
	await act(async () => {
		result.current.toggleSidebarSectionCollapsed("workspaces");
		result.current.toggleSidebarSectionCollapsed("userStories");
	});
	await act(async () => {
		current = orgB;
		rerender();
	});
	await act(async () => {
		result.current.toggleSidebarSectionCollapsed("sessions");
	});
	unmount();
	await cleanupQueries();
	await orgA.v2UserPreferences.cleanup();
	await orgB.v2UserPreferences.cleanup();
	orgA = makeOrganization("org-a");
	orgB = makeOrganization("org-b");
	current = orgA;
	const restored = renderHook(() => useV2UserPreferences());
	await waitFor(() =>
		expect(
			restored.result.current.preferences.sidebarSectionsCollapsed,
		).toEqual({ workspaces: true, sessions: false, userStories: true }),
	);
	await act(async () => {
		current = orgB;
		restored.rerender();
	});
	await waitFor(() =>
		expect(
			restored.result.current.preferences.sidebarSectionsCollapsed,
		).toEqual({ ...defaults, sessions: true }),
	);
	expect([...disk.keys()].sort()).toEqual([
		"v2-user-preferences-org-a",
		"v2-user-preferences-org-b",
	]);
});

test("an existing saved preferences row survives the first toggle", async () => {
	await orgA.v2UserPreferences.cleanup();
	disk.set(
		"v2-user-preferences-org-a",
		JSON.stringify({
			"s:preferences": {
				versionKey: "old",
				data: {
					id: "preferences",
					rightSidebarWidth: 500,
					hiddenTagFolders: { project: ["folder"] },
					sidebarProjectSortMode: "active",
				},
			},
		}),
	);
	orgA = makeOrganization("org-a");
	current = orgA;
	const { result } = renderHook(() => useV2UserPreferences());
	await waitFor(() =>
		expect(result.current.preferences.rightSidebarWidth).toBe(500),
	);
	expect(result.current.preferences.sidebarSectionsCollapsed).toEqual(defaults);
	await act(async () => {
		result.current.toggleSidebarSectionCollapsed("sessions");
	});
	const row = orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID);
	expect(row?.rightSidebarWidth).toBe(500);
	expect(row?.hiddenTagFolders).toEqual({ project: ["folder"] });
	expect(row?.sidebarProjectSortMode).toBe("active");
});

test("Cloud and Pinned retain the global toggle and organization preferences stay untouched", async () => {
	const { result } = renderHook(() => ({
		cloud: useSidebarSectionCollapse("cloud"),
		pinned: useSidebarSectionCollapse("pinned"),
	}));
	await act(async () => {
		result.current.cloud.toggle();
		result.current.pinned.toggle();
	});
	expect(result.current.cloud.isCollapsed).toBe(true);
	expect(result.current.pinned.isCollapsed).toBe(true);
	expect(orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
});

test("section selector and callbacks follow organization changes together", async () => {
	const { result, rerender } = renderHook(() => ({
		workspaces: useSidebarSectionCollapse("workspaces"),
		sessions: useSidebarSectionCollapse("sessions"),
		userStories: useSidebarSectionCollapse("userStories"),
	}));
	await act(async () => {
		for (const section of sections) result.current[section].toggle();
	});
	await waitFor(() => {
		for (const section of sections)
			expect(result.current[section].isCollapsed).toBe(true);
	});
	await act(async () => {
		current = orgB;
		rerender();
	});
	for (const section of sections)
		expect(result.current[section].isCollapsed).toBe(false);
	await act(async () => {
		result.current.sessions.toggle();
	});
	await waitFor(() => expect(result.current.sessions.isCollapsed).toBe(true));
	expect(result.current.workspaces.isCollapsed).toBe(false);
	expect(result.current.userStories.isCollapsed).toBe(false);
	await act(async () => {
		current = orgA;
		rerender();
	});
	await waitFor(() => {
		for (const section of sections)
			expect(result.current[section].isCollapsed).toBe(true);
	});
});

test("absent query rows show defaults and never overwrite saved choices", async () => {
	orgA.v2UserPreferences.insert({
		...DEFAULT_V2_USER_PREFERENCES,
		sidebarSectionsCollapsed: { ...defaults, workspaces: true },
	});
	forcedRows = [];
	const saved = disk.get("v2-user-preferences-org-a");
	const { result, rerender } = renderHook(() => useV2UserPreferences());
	expect(result.current.preferences.sidebarSectionsCollapsed).toEqual(defaults);
	expect(disk.get("v2-user-preferences-org-a")).toBe(saved);
	await act(async () => {
		forcedRows = null;
		rerender();
	});
	await waitFor(() =>
		expect(result.current.preferences.sidebarSectionsCollapsed.workspaces).toBe(
			true,
		),
	);
});

test.each([
	{
		version: 0,
		state: { isCollapsed: true },
		expected: { ...defaults, workspaces: true },
	},
	{ version: 0, state: { isCollapsed: false }, expected: defaults },
	{
		version: 1,
		state: {
			collapsed: {
				workspaces: true,
				sessions: true,
				userStories: false,
				cloud: true,
				pinned: true,
			},
		},
		expected: { workspaces: true, sessions: true, userStories: false },
	},
	{
		version: 1,
		state: {
			collapsed: { workspaces: false, sessions: false, userStories: true },
		},
		expected: { workspaces: false, sessions: false, userStories: true },
	},
])("imports legacy v$version once into the active org and restores after reload", async ({
	version,
	state,
	expected,
}) => {
	await seedLegacy(version, state);
	const { result, rerender, unmount } = renderHook(() => ({
		workspaces: useSidebarSectionCollapse("workspaces"),
		sessions: useSidebarSectionCollapse("sessions"),
		userStories: useSidebarSectionCollapse("userStories"),
	}));
	await waitFor(() =>
		expect(
			orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
				?.sidebarSectionsCollapsed,
		).toEqual(expected),
	);
	expect(
		useSidebarSectionsCollapseStore.getState().legacyMigrationOrganizationId,
	).toBe("org-a");
	expect(
		useSidebarSectionsCollapseStore.getState().legacyMigrationComplete,
	).toBe(true);
	if (version === 1 && "collapsed" in state && "cloud" in state.collapsed) {
		expect(useSidebarSectionsCollapseStore.getState().collapsed.cloud).toBe(
			true,
		);
		expect(useSidebarSectionsCollapseStore.getState().collapsed.pinned).toBe(
			true,
		);
	}
	await act(async () => {
		result.current.workspaces.toggle();
	});
	const chosen = { ...expected, workspaces: !expected.workspaces };
	await act(async () => {
		current = orgB;
		rerender();
	});
	for (const section of sections)
		expect(result.current[section].isCollapsed).toBe(false);
	expect(orgB.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
	await act(async () => {
		current = orgA;
		rerender();
	});
	await waitFor(() =>
		expect(result.current.workspaces.isCollapsed).toBe(chosen.workspaces),
	);
	unmount();
	await cleanupQueries();
	await orgA.v2UserPreferences.cleanup();
	await orgB.v2UserPreferences.cleanup();
	orgA = makeOrganization("org-a");
	orgB = makeOrganization("org-b");
	const persistedLegacy = legacyDisk.get(SIDEBAR_SECTIONS_COLLAPSE_STORAGE_KEY);
	if (!persistedLegacy) throw new Error("Missing migrated legacy snapshot");
	useSidebarSectionsCollapseStore.setState({
		legacyMigrationOrganizationId: null,
		legacyMigrationComplete: false,
	});
	legacyDisk.set(SIDEBAR_SECTIONS_COLLAPSE_STORAGE_KEY, persistedLegacy);
	await useSidebarSectionsCollapseStore.persist.rehydrate();
	current = orgB;
	const restored = renderHook(() => useSidebarSectionCollapse("workspaces"));
	expect(restored.result.current.isCollapsed).toBe(false);
	expect(orgB.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
	await act(async () => {
		current = orgA;
		restored.rerender();
	});
	await waitFor(() =>
		expect(restored.result.current.isCollapsed).toBe(chosen.workspaces),
	);
	expect(
		orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
			?.sidebarSectionsCollapsed,
	).toEqual(chosen);
});

test.each([
	defaults,
	{ workspaces: false, sessions: true, userStories: false },
])("preserves already saved organization choices even when they are expanded", async (choices) => {
	await seedLegacy(1, {
		collapsed: { workspaces: true, sessions: true, userStories: true },
	});
	await seedOrganization("org-a", {
		id: "preferences",
		sidebarSectionsCollapsed: choices,
		rightSidebarTab: "changes",
		rightSidebarOpen: false,
		rightSidebarWidth: 520,
	});
	renderHook(() => useSidebarSectionCollapse("workspaces"));
	await waitFor(() =>
		expect(
			useSidebarSectionsCollapseStore.getState().legacyMigrationComplete,
		).toBe(true),
	);
	const row = orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID);
	expect(row?.sidebarSectionsCollapsed).toEqual(choices);
	expect(row?.rightSidebarTab).toBe("changes");
	expect(row?.rightSidebarOpen).toBe(false);
	expect(row?.rightSidebarWidth).toBe(520);
	expect([...disk.keys()]).toEqual(["v2-user-preferences-org-a"]);
});

test("imports into a healed older preferences row while preserving unrelated preferences and Files defaults", async () => {
	await seedOrganization("org-a", {
		id: "preferences",
		rightSidebarWidth: 510,
		rightSidebarOpen: false,
		hiddenTagFolders: { project: ["folder"] },
	});
	await seedLegacy(1, {
		collapsed: { workspaces: true, sessions: false, userStories: true },
	});
	renderHook(() => useSidebarSectionCollapse("sessions"));
	await waitFor(() =>
		expect(
			orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
				?.sidebarSectionsCollapseInitialized,
		).toBe(true),
	);
	const row = orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID);
	expect(row?.sidebarSectionsCollapsed).toEqual({
		workspaces: true,
		sessions: false,
		userStories: true,
	});
	expect(row?.rightSidebarTab).toBe("files");
	expect(row?.rightSidebarWidth).toBe(510);
	expect(row?.rightSidebarOpen).toBe(false);
	expect(row?.hiddenTagFolders).toEqual({ project: ["folder"] });
});

test("StrictMode and multiple consumers import once; rehydration does not overwrite a later toggle", async () => {
	await seedLegacy(1, {
		collapsed: { workspaces: true, sessions: true, userStories: true },
	});
	const insert = mock(
		orgA.v2UserPreferences.insert.bind(orgA.v2UserPreferences),
	);
	orgA.v2UserPreferences.insert = insert;
	const { result } = renderHook(
		() => ({
			one: useSidebarSectionCollapse("workspaces"),
			two: useSidebarSectionCollapse("sessions"),
			three: useSidebarSectionCollapse("userStories"),
		}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<StrictMode>{children}</StrictMode>
			),
		},
	);
	expect(insert).toHaveBeenCalledTimes(1);
	await act(async () => {
		result.current.one.toggle();
	});
	await act(async () => {
		await useSidebarSectionsCollapseStore.persist.rehydrate();
	});
	expect(insert).toHaveBeenCalledTimes(1);
	await waitFor(() => expect(result.current.one.isCollapsed).toBe(false));
});

test("late legacy hydration imports into the currently active org after rapid switches, ignoring stale query data", async () => {
	let release: (value: StorageValue<LegacyStorageState>) => void = () => {};
	const pending = new Promise<Parameters<typeof release>[0]>((resolve) => {
		release = resolve;
	});
	useSidebarSectionsCollapseStore.persist.setOptions({
		storage: {
			getItem: () => pending,
			setItem: legacyStorage?.setItem ?? (() => {}),
			removeItem: legacyStorage?.removeItem ?? (() => {}),
		},
	});
	const hydration = useSidebarSectionsCollapseStore.persist.rehydrate();
	forcedRows = [
		{
			organizationId: "org-a",
			preferences: {
				...DEFAULT_V2_USER_PREFERENCES,
				sidebarSectionsCollapsed: { ...defaults, sessions: true },
			},
		},
	];
	const { rerender } = renderHook(() =>
		useSidebarSectionCollapse("workspaces"),
	);
	await act(async () => {
		current = orgB;
		rerender();
	});
	await act(async () => {
		current = orgA;
		rerender();
	});
	await act(async () => {
		current = orgB;
		rerender();
	});
	await act(async () => {
		release({
			state: {
				collapsed: {
					cloud: false,
					pinned: false,
					workspaces: true,
					sessions: false,
					userStories: true,
				},
				legacyMigrationOrganizationId: null,
				legacyMigrationComplete: false,
			},
			version: 1,
		});
		await hydration;
	});
	expect(orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
	expect(
		orgB.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
			?.sidebarSectionsCollapsed,
	).toEqual({ workspaces: true, sessions: false, userStories: true });
	expect(
		useSidebarSectionsCollapseStore.getState().legacyMigrationOrganizationId,
	).toBe("org-b");
});

test("a claimed but interrupted import can resume only for its original organization", async () => {
	await seedLegacy(2, {
		collapsed: {
			workspaces: true,
			sessions: true,
			userStories: false,
			cloud: false,
			pinned: false,
		},
		legacyMigrationOrganizationId: "org-a",
		legacyMigrationComplete: false,
	});
	current = orgB;
	const { rerender } = renderHook(() => useSidebarSectionCollapse("sessions"));
	expect(orgB.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
	await act(async () => {
		current = orgA;
		rerender();
	});
	expect(
		orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
			?.sidebarSectionsCollapsed,
	).toEqual({ workspaces: true, sessions: true, userStories: false });
	expect(
		useSidebarSectionsCollapseStore.getState().legacyMigrationComplete,
	).toBe(true);
});

test("a delayed collection readiness callback cannot import into an organization already left", async () => {
	await seedLegacy(1, {
		collapsed: { workspaces: true, sessions: true, userStories: true },
	});
	let notifyReady = () => {};
	let ready = false;
	orgA.v2UserPreferences.isReady = () => ready;
	orgA.v2UserPreferences.onFirstReady = (callback) => {
		notifyReady = callback;
	};
	const { rerender } = renderHook(() =>
		useSidebarSectionCollapse("workspaces"),
	);
	expect(
		useSidebarSectionsCollapseStore.getState().legacyMigrationOrganizationId,
	).toBeNull();
	expect(orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
	await act(async () => {
		current = orgB;
		rerender();
	});
	expect(
		useSidebarSectionsCollapseStore.getState().legacyMigrationOrganizationId,
	).toBe("org-b");
	await act(async () => {
		ready = true;
		notifyReady();
	});
	expect(orgA.v2UserPreferences.get(V2_USER_PREFERENCES_ID)).toBeUndefined();
	expect(
		orgB.v2UserPreferences.get(V2_USER_PREFERENCES_ID)
			?.sidebarSectionsCollapsed,
	).toEqual({ workspaces: true, sessions: true, userStories: true });
});
