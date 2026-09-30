import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SearchAddon } from "@xterm/addon-search";
import type { ITerminalAddon } from "@xterm/xterm";
import { createOptionalTerminalAddons } from "./optional-addons";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture() {
	const loaded: ITerminalAddon[] = [];
	const terminal = {
		rows: 24,
		loadAddon: mock((addon: ITerminalAddon) => {
			loaded.push(addon);
		}),
		refresh: mock(),
	};
	const search = deferred<{ SearchAddon: typeof SearchAddon }>();
	const ligatures = deferred<{ LigaturesAddon: typeof LigaturesAddon }>();
	const loaders = {
		search: mock(() => search.promise),
		ligatures: mock(() => ligatures.promise),
	};
	return {
		terminal,
		loaded,
		search,
		ligatures,
		loaders,
		addons: createOptionalTerminalAddons(terminal, loaders),
	};
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(() => mock.restore());

test("creation imports nothing and concurrent search requests share one activation", async () => {
	const f = fixture();
	expect(f.loaders.search).not.toHaveBeenCalled();
	expect(f.loaders.ligatures).not.toHaveBeenCalled();
	expect(f.addons.searchAddon).toBeNull();
	const first = f.addons.ensureSearchAddon();
	expect(f.addons.ensureSearchAddon()).toBe(first);
	f.search.resolve({ SearchAddon });
	const addon = await first;
	expect(addon).toBeInstanceOf(SearchAddon);
	expect(await f.addons.ensureSearchAddon()).toBe(addon);
	expect(f.loaders.search).toHaveBeenCalledTimes(1);
	expect(f.terminal.loadAddon).toHaveBeenCalledTimes(1);
});

test("disposed terminals never activate a pending search or start new imports", async () => {
	const f = fixture();
	const pending = f.addons.ensureSearchAddon();
	f.addons.dispose();
	f.search.resolve({ SearchAddon });
	expect(await pending).toBeNull();
	expect(await f.addons.ensureSearchAddon()).toBeNull();
	expect(f.terminal.loadAddon).not.toHaveBeenCalled();
	expect(f.loaders.search).toHaveBeenCalledTimes(1);
});

test("failed search imports can retry without retaining a broken promise", async () => {
	spyOn(console, "warn").mockImplementation(() => {});
	const f = fixture();
	const pending = f.addons.ensureSearchAddon();
	f.search.reject(new Error("chunk unavailable"));
	expect(await pending).toBeNull();
	f.loaders.search.mockImplementation(() => Promise.resolve({ SearchAddon }));
	expect(await f.addons.ensureSearchAddon()).toBeInstanceOf(SearchAddon);
	expect(f.loaders.search).toHaveBeenCalledTimes(2);
});

test("search activation failure disposes the partially loaded addon", async () => {
	spyOn(console, "warn").mockImplementation(() => {});
	const f = fixture();
	const dispose = spyOn(SearchAddon.prototype, "dispose").mockImplementation(
		() => {},
	);
	f.terminal.loadAddon.mockImplementation((addon) => {
		f.loaded.push(addon);
		throw new Error("activation failed");
	});
	const pending = f.addons.ensureSearchAddon();
	f.search.resolve({ SearchAddon });
	expect(await pending).toBeNull();
	expect(dispose).toHaveBeenCalledTimes(1);
	expect(f.addons.searchAddon).toBeNull();
});

test("disable during ligature import cancels activation and a later enable can retry", async () => {
	const f = fixture();
	f.addons.setLigaturesEnabled(true);
	f.addons.setLigaturesEnabled(false);
	f.ligatures.resolve({ LigaturesAddon });
	await flush();
	expect(f.terminal.loadAddon).not.toHaveBeenCalled();
	f.addons.setLigaturesEnabled(true);
	await flush();
	expect(f.loaded[0]).toBeInstanceOf(LigaturesAddon);
	expect(f.terminal.refresh).toHaveBeenCalledWith(0, 23);
	const dispose = spyOn(f.loaded[0], "dispose");
	f.addons.setLigaturesEnabled(false);
	expect(dispose).toHaveBeenCalledTimes(1);
});

test("rapid ligature toggles use one pending import and the latest intent", async () => {
	const f = fixture();
	f.addons.setLigaturesEnabled(true);
	f.addons.setLigaturesEnabled(false);
	f.addons.setLigaturesEnabled(true);
	f.ligatures.resolve({ LigaturesAddon });
	await flush();
	expect(f.loaders.ligatures).toHaveBeenCalledTimes(1);
	expect(f.terminal.loadAddon).toHaveBeenCalledTimes(1);
	f.addons.setLigaturesEnabled(true);
	expect(f.loaders.ligatures).toHaveBeenCalledTimes(1);
});

test("dispose while loading ligatures prevents activation and future loads", async () => {
	const f = fixture();
	f.addons.setLigaturesEnabled(true);
	f.addons.dispose();
	f.ligatures.resolve({ LigaturesAddon });
	await flush();
	f.addons.setLigaturesEnabled(true);
	expect(f.terminal.loadAddon).not.toHaveBeenCalled();
	expect(f.loaders.ligatures).toHaveBeenCalledTimes(1);
});

test("instances sharing a module load retain independent addons and lifetimes", async () => {
	const f = fixture();
	const other = createOptionalTerminalAddons(f.terminal, f.loaders);
	const first = f.addons.ensureSearchAddon();
	const second = other.ensureSearchAddon();
	f.addons.dispose();
	f.search.resolve({ SearchAddon });
	expect(await first).toBeNull();
	expect(await second).toBeInstanceOf(SearchAddon);
	expect(f.terminal.loadAddon).toHaveBeenCalledTimes(1);
});
