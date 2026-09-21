import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { OrdemCharacterAppearance } from "@superset/shared/ordem-paranormal";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { cleanup, render } = await import("@testing-library/react");
const React = await import("react");
const { DossierTimeline } = await import("./DossierTimeline");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

const appearances: OrdemCharacterAppearance[] = [
	{
		branch: "feat/arthur-cervero-task",
		discoveredAt: "2026-09-20T12:00:00Z",
		project: "weaves",
	},
];

describe("DossierTimeline", () => {
	test("renders invocation statistics and branch appearances", () => {
		const { container } = render(
			React.createElement(DossierTimeline, {
				appearances,
				timesUsed: 3,
				firstDiscoveredAt: "2026-09-10T10:00:00Z",
			}),
		);

		expect(container.textContent).toContain("3x");
		expect(container.textContent).toContain("feat/arthur-cervero-task");
		expect(container.textContent).toContain("weaves");
	});
});
