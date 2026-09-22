import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useScrollReset } from "renderer/routes/_authenticated/settings/hooks/useScrollReset";

export const Route = createFileRoute("/_authenticated/settings/automations")({
	component: AutomationsSettingsLayout,
});

function AutomationsSettingsLayout() {
	const { pathname } = useLocation();
	const contentRef = useScrollReset<HTMLDivElement>(pathname);
	return (
		<div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto">
			<Outlet />
		</div>
	);
}
