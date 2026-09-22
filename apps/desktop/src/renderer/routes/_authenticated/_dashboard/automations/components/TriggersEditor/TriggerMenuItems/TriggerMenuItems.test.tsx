import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { act, cleanup, render, within } = await import("@testing-library/react");
const { DropdownMenu, DropdownMenuContent } = await import(
	"@superset/ui/dropdown-menu"
);
const { TriggerMenuItems } = await import("./TriggerMenuItems");
const { TRIGGER_PROVIDERS } = await import("../../providers");

afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

async function menu() {
	const onPick = mock(() => {});
	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = render(
			<DropdownMenu open>
				<DropdownMenuContent>
					<TriggerMenuItems providers={TRIGGER_PROVIDERS} onPick={onPick} />
				</DropdownMenuContent>
			</DropdownMenu>,
		);
	});
	return { ui: within(view.baseElement as HTMLElement), onPick };
}

test("lists Microsoft Teams without a plan badge or disabled state", async () => {
	const { ui } = await menu();
	const teams = ui.getByText("Microsoft Teams");
	expect(teams).toBeDefined();
	expect(ui.queryByText("Enterprise")).toBeNull();
	expect(teams.closest('[data-disabled="true"]')).toBeNull();
});

test("puts a single-trigger provider straight on the row", async () => {
	const { ui } = await menu();
	const webhook = ui.getByText("Webhook triggered").closest("[role=menuitem]");
	expect(webhook).not.toBeNull();
});
