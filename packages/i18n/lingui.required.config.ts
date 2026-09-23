import { defineConfig } from "@lingui/cli";
import baseConfig from "./lingui.config";

export default defineConfig({
	...baseConfig,
	locales: ["en", "pt-BR"],
	fallbackLocales: false,
});
