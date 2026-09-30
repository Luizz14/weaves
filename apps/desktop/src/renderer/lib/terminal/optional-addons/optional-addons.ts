import type { LigaturesAddon } from "@xterm/addon-ligatures";
import type { SearchAddon } from "@xterm/addon-search";
import type { ITerminalAddon, Terminal } from "@xterm/xterm";

type OptionalAddonLoaders = {
	search: () => Promise<{ SearchAddon: typeof SearchAddon }>;
	ligatures: () => Promise<{ LigaturesAddon: typeof LigaturesAddon }>;
};

const DEFAULT_LOADERS: OptionalAddonLoaders = {
	search: () => import("@xterm/addon-search"),
	ligatures: () => import("@xterm/addon-ligatures"),
};

function disposeAddon(addon: ITerminalAddon | null): void {
	try {
		addon?.dispose();
	} catch {}
}

export function createOptionalTerminalAddons(
	terminal: Pick<Terminal, "loadAddon" | "refresh" | "rows">,
	loaders: OptionalAddonLoaders = DEFAULT_LOADERS,
) {
	let disposed = false;
	let searchAddon: SearchAddon | null = null;
	let searchLoading: Promise<SearchAddon | null> | null = null;
	let ligaturesAddon: LigaturesAddon | null = null;
	let ligaturesLoading: Promise<void> | null = null;
	let ligaturesEnabled = false;

	const ensureSearchAddon = (): Promise<SearchAddon | null> => {
		if (disposed) return Promise.resolve(null);
		if (searchAddon) return Promise.resolve(searchAddon);
		if (searchLoading) return searchLoading;
		searchLoading = loaders
			.search()
			.then(({ SearchAddon }) => {
				if (disposed) return null;
				searchAddon = new SearchAddon();
				terminal.loadAddon(searchAddon);
				return searchAddon;
			})
			.catch((error) => {
				disposeAddon(searchAddon);
				searchAddon = null;
				console.warn("[terminal] Search addon unavailable", error);
				return null;
			})
			.finally(() => {
				searchLoading = null;
			});
		return searchLoading;
	};

	const setLigaturesEnabled = (enabled: boolean): void => {
		if (disposed) return;
		ligaturesEnabled = enabled;
		if (!enabled) {
			disposeAddon(ligaturesAddon);
			ligaturesAddon = null;
			return;
		}
		if (ligaturesAddon || ligaturesLoading) return;
		ligaturesLoading = loaders
			.ligatures()
			.then(({ LigaturesAddon }) => {
				if (disposed || !ligaturesEnabled) return;
				ligaturesAddon = new LigaturesAddon();
				terminal.loadAddon(ligaturesAddon);
				terminal.refresh(0, terminal.rows - 1);
			})
			.catch((error) => {
				disposeAddon(ligaturesAddon);
				ligaturesAddon = null;
				console.warn("[terminal] Ligatures addon unavailable", error);
			})
			.finally(() => {
				ligaturesLoading = null;
			});
	};

	return {
		get searchAddon() {
			return disposed ? null : searchAddon;
		},
		ensureSearchAddon,
		setLigaturesEnabled,
		dispose: () => {
			disposed = true;
			searchAddon = null;
			disposeAddon(ligaturesAddon);
			ligaturesAddon = null;
		},
	};
}
