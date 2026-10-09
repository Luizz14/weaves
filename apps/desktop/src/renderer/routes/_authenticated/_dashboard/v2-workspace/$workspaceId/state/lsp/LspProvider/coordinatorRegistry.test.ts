import { afterEach, expect, test } from "bun:test";
import type { LspCoordinator } from "../coordinator";
import {
	acquireCoordinator,
	disposeAllCoordinators,
	disposeIdleCoordinatorsOutside,
	getCoordinator,
	releaseCoordinator,
} from "./coordinatorRegistry";

afterEach(disposeAllCoordinators);

function fakeCoordinator() {
	const coordinator = {
		disposed: false,
		dispose() {
			coordinator.disposed = true;
		},
	};
	return coordinator;
}

test("a released workspace keeps its coordinator for its return", () => {
	const created = fakeCoordinator();
	const first = getCoordinator(
		"a",
		"org",
		() => created as unknown as LspCoordinator,
	);
	acquireCoordinator("a");
	releaseCoordinator("a");
	const again = getCoordinator(
		"a",
		"org",
		() => fakeCoordinator() as unknown as LspCoordinator,
	);
	expect(again).toBe(first);
	expect(created.disposed).toBe(false);
});

test("only the two most recently left workspaces stay alive", () => {
	const coordinators = ["a", "b", "c"].map((key) => {
		const coordinator = fakeCoordinator();
		getCoordinator(key, "org", () => coordinator as unknown as LspCoordinator);
		acquireCoordinator(key);
		return coordinator;
	});
	for (const key of ["a", "b", "c"]) releaseCoordinator(key);
	expect(coordinators.map((coordinator) => coordinator.disposed)).toEqual([
		true,
		false,
		false,
	]);
});

test("switching organization disposes the other organization's idle workspaces", () => {
	const left = fakeCoordinator();
	getCoordinator("a", "org", () => left as unknown as LspCoordinator);
	acquireCoordinator("a");
	releaseCoordinator("a");
	const open = fakeCoordinator();
	getCoordinator("b", "org", () => open as unknown as LspCoordinator);
	acquireCoordinator("b");
	disposeIdleCoordinatorsOutside("other");
	expect(left.disposed).toBe(true);
	expect(open.disposed).toBe(false);
});
