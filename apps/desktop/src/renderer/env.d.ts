/// <reference types="vite/client" />

import type { AppBridge } from "./lib/native-bridge";

declare global {
	interface Window {
		App: AppBridge;
	}
}
