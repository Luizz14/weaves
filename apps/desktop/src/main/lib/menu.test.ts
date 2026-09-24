import { describe, expect, mock, test } from "bun:test";
import { dispatchNativeMenuClick } from "./menu-action-router";

describe("native menu action bridge", () => {
	test("maps Rust semantic menu ids to renderer events", () => {
		const emitted: unknown[][] = [];
		const emit = mock((event: string, ...args: unknown[]) => {
			emitted.push([event, ...args]);
			return true;
		});
		const checkUpdates = mock(() => {});
		const quit = mock(() => {});
		const quitCompletely = mock(() => {});
		const deps = { emit, checkUpdates, quit, quitCompletely };

		for (const id of [
			"new-window",
			"open-project",
			"settings",
			"toggle-presets-bar",
			"check-resources",
			"keyboard-shortcuts",
		]) {
			dispatchNativeMenuClick(id, deps);
		}

		expect(emitted).toEqual([
			["new-window"],
			["open-project"],
			["open-settings"],
			["toggle-presets-bar"],
			["check-resources"],
			["open-settings", "keyboard"],
		]);
		expect(checkUpdates).not.toHaveBeenCalled();
		expect(quit).not.toHaveBeenCalled();
		expect(quitCompletely).not.toHaveBeenCalled();
	});

	test("routes update and quit actions to native lifecycle callbacks", () => {
		const emit = mock(() => true);
		const checkUpdates = mock(() => {});
		const quit = mock(() => {});
		const quitCompletely = mock(() => {});
		const deps = { emit, checkUpdates, quit, quitCompletely };

		dispatchNativeMenuClick("check-updates", deps);
		dispatchNativeMenuClick("quit", deps);
		dispatchNativeMenuClick("quit-completely", deps);
		expect(checkUpdates).toHaveBeenCalledTimes(1);
		expect(quit).toHaveBeenCalledTimes(1);
		expect(quitCompletely).toHaveBeenCalledTimes(1);
	});

	test("ignores unknown native menu ids", () => {
		const emit = mock(() => true);
		const checkUpdates = mock(() => {});
		const quit = mock(() => {});
		const quitCompletely = mock(() => {});
		dispatchNativeMenuClick("unknown", {
			emit,
			checkUpdates,
			quit,
			quitCompletely,
		});
		expect(emit).not.toHaveBeenCalled();
		expect(checkUpdates).not.toHaveBeenCalled();
		expect(quit).not.toHaveBeenCalled();
		expect(quitCompletely).not.toHaveBeenCalled();
	});
});
