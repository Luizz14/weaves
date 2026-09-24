declare module "react-devtools-inline/backend" {
	export function initialize(windowOrGlobal: Window): void;
	export function activate(windowOrGlobal: Window): void;
}

declare module "react-devtools-inline/frontend" {
	import type { ComponentType } from "react";

	export function initialize(
		windowOrGlobal: Window,
	): ComponentType<Record<string, unknown>>;
}

declare module "react-devtools-inline/hookNames" {
	export const parseHookNames: unknown;
}
