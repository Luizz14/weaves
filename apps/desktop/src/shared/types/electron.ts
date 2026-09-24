import type { NativeWindowOptions } from "main/native/platform";

/** Window options shared by the legacy factory name and the native host. */
export interface WindowProps extends NativeWindowOptions {
	id: string;
	query?: Record<string, string>;
}
