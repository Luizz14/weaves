import { resolve } from "node:path";
import { defineConfig } from "vite";

const desktopDirectory = import.meta.dirname;

export default defineConfig({
	root: resolve(desktopDirectory, "src/renderer"),
	publicDir: false,
	build: {
		emptyOutDir: false,
		outDir: resolve(desktopDirectory, "dist/resources"),
		sourcemap: false,
		rollupOptions: {
			input: resolve(
				desktopDirectory,
				"src/renderer/lib/legacy-profile-exporter.ts",
			),
			output: {
				format: "iife",
				inlineDynamicImports: true,
				entryFileNames: "profile-migration-exporter.js",
			},
		},
	},
});
