import {
	createNativeWindow,
	type NativeWindowHandle,
} from "main/native/platform";
import type { WindowProps } from "shared/types";

/** Legacy factory name retained while all window creation is native-owned. */
export async function createWindow({
	id,
	query: _query,
	...settings
}: WindowProps): Promise<NativeWindowHandle> {
	return createNativeWindow({ ...settings, id, label: settings.label ?? id });
}
