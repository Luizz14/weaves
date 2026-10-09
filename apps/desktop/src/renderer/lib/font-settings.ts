import { queryOptions } from "@tanstack/react-query";
import type { ElectronRouterOutputs } from "./electron-trpc";
import { electronTrpcClient } from "./trpc-client";

export const FONT_SETTINGS_QUERY_KEY = [
	"electron",
	"settings",
	"getFontSettings",
] as const;

export type FontSettings = ElectronRouterOutputs["settings"]["getFontSettings"];

export const fontSettingsQueryOptions = queryOptions({
	queryKey: FONT_SETTINGS_QUERY_KEY,
	queryFn: () => electronTrpcClient.settings.getFontSettings.query(),
	staleTime: 30_000,
});
