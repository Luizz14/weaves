import { afterEach, expect, test } from "bun:test";
import type { LspCoordinator } from "../coordinator";
import {
	acquireCoordinator,
	disposeAllCoordinators,
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
	const first = getCoordinator("a", () => created as unknown as LspCoordinator);
	acquireCoordinator("a");
	releaseCoordinator("a");
	const again = getCoordinator(
		"a",
		() => fakeCoordinator() as unknown as LspCoordinator,
	);
	expect(again).toBe(first);
	expect(created.disposed).toBe(false);
});

test("only the two most recently left workspaces stay alive", () => {
	const coordinators = ["a", "b", "c"].map((key) => {
		const coordinator = fakeCoordinator();
		getCoordinator(key, () => coordinator as unknown as LspCoordinator);
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
