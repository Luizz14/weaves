import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	ensureSpareLease,
	resetSpareLeasesForTesting,
	takeSpareLease,
} from "./terminalSpareLeases";

beforeEach(() => resetSpareLeasesForTesting());

describe("terminal spare leases", () => {
	test("hands a prepared spare out once, and only for its theme", async () => {
		const prepare = mock(async () => ({ terminalId: "spare-1" }));
		const release = mock(async () => {});

		await ensureSpareLease({
			workspaceId: "ws",
			themeType: "dark",
			prepare,
			release,
		});

		expect(takeSpareLease("ws", "light")).toBeNull();
		await ensureSpareLease({
			workspaceId: "ws",
			themeType: "dark",
			prepare,
			release,
		});
		expect(takeSpareLease("ws", "dark")).toBe("spare-1");
		expect(takeSpareLease("ws", "dark")).toBeNull();
	});

	test("shares one request and releases a lease started for another theme", async () => {
		const prepare = mock(async () => ({ terminalId: "spare-dark" }));
		const release = mock(async () => {});

		await Promise.all([
			ensureSpareLease({
				workspaceId: "ws",
				themeType: "dark",
				prepare,
				release,
			}),
			ensureSpareLease({
				workspaceId: "ws",
				themeType: "dark",
				prepare,
				release,
			}),
		]);
		expect(prepare).toHaveBeenCalledTimes(1);

		prepare.mockImplementation(async () => ({ terminalId: "spare-light" }));
		await ensureSpareLease({
			workspaceId: "ws",
			themeType: "light",
			prepare,
			release,
		});

		expect(release).toHaveBeenCalledWith("spare-dark");
		expect(takeSpareLease("ws", "light")).toBe("spare-light");
	});

	test("expires leases before the host retires the spare", async () => {
		await ensureSpareLease({
			workspaceId: "ws",
			themeType: "dark",
			prepare: async () => ({ terminalId: "spare-1" }),
			release: async () => {},
		});

		expect(takeSpareLease("ws", "dark", Date.now() + 10 * 60_000)).toBeNull();
	});
});
