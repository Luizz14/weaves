import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { StartupMark } from "renderer/components/StartupMark";
import { RootLayout } from "./-layout";
import { ErrorPage } from "./error";
import { NotFound } from "./not-found";

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
	notFoundComponent: NotFound,
	errorComponent: ErrorPage,
});

function RootComponent() {
	return (
		<RootLayout>
			<StartupMark marker="router-ready" />
			<Outlet />
		</RootLayout>
	);
}
