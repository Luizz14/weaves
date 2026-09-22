import { describe, expect, it } from "bun:test";
import type { TrpcContext } from "../context";
import { createOrdemParanormalRouter } from "./ordem-paranormal";

describe("Ordem Paranormal tRPC Router", () => {
	const mockContext = {} as unknown as TrpcContext;

	it("retrieves character details by id", async () => {
		const router = createOrdemParanormalRouter();
		const caller = router.createCaller(mockContext);

		const char = await caller.getCharacter({ id: "arthur-cervero" });
		expect(char).not.toBeNull();
		expect(char?.name).toBe("Arthur Cervero");
		expect(char?.element).toBe("Sangue");
	});

	it("returns null for non-existent character id", async () => {
		const router = createOrdemParanormalRouter();
		const caller = router.createCaller(mockContext);

		const char = await caller.getCharacter({ id: "non-existent-character" });
		expect(char).toBeNull();
	});

	it("records discovery by branch name", async () => {
		const router = createOrdemParanormalRouter();
		const caller = router.createCaller(mockContext);

		const entry = await caller.recordDiscoveryByBranch({
			branch: "joui-jouki",
			project: "test-project",
		});

		expect(entry).not.toBeNull();
		expect(entry?.slug).toBe("joui-jouki");
	});

	it("returns null for branch not matching any character", async () => {
		const router = createOrdemParanormalRouter();
		const caller = router.createCaller(mockContext);

		const entry = await caller.recordDiscoveryByBranch({
			branch: "fix/regular-bugfix",
		});

		expect(entry).toBeNull();
	});

	it("triggers test reveal for popup verification", async () => {
		const router = createOrdemParanormalRouter();
		const caller = router.createCaller(mockContext);

		const char = await caller.triggerTestReveal({ characterId: "kaiser" });
		expect(char).not.toBeNull();
		expect(char?.id).toBe("kaiser");
	});
});
